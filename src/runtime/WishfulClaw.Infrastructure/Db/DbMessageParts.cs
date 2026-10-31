/*
 * S-285：助手消息的块结构（thinking / text / tool_use）独立存储。
 *
 * 根因（S-285 §二）：`messages.meta` 是整行覆盖语义，而工具调用在语义上是追加的。
 * 一条 148 次工具调用的消息，每次完成边界都把 14 MB 的 meta 重新 stringify 后整行 upsert，
 * 累计 2.07 GB 的分配与 IPC 传输。本文件把「块结构」从 meta 搬到 message_parts，
 * 让每次状态更新退化成「单行 INSERT OR REPLACE」。
 *
 * 零迁移：老消息的 meta 里仍带 segments/toolCalls，按 message_id 逐条判断，原样写回。
 * 同一会话前半段老、后半段新是正常态，不是边界情况。
 */

using System.Buffers;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// S-285：`message_parts` 表的读写与 meta 合并。
///
/// <para><b>kind 值域与 payload 形状：本类是全项目唯一定义源。</b>
/// 渲染侧对应 <c>src/renderer/src/stores/chat-store/types.ts</c> 的
/// <c>ContentSegment</c>（<c>type: 'thinking' | 'text' | 'tool_use'</c>）。
/// 跨语言共用不了类型，两侧各写一份，改一处必须同步另一处 —— 这是 S-276
/// 「四处轮次判据各写各的」栽过的坑，别重演。</para>
///
/// <para><b>payload 形状</b>：一个完整的 <c>ContentSegment</c> 对象 JSON。
/// 读侧从 tool_use 段重建 <c>toolCalls</c>（两者的字段完全重叠：id/toolCallId、
/// name/toolName、input、status、output、error、startedAt、completedAt），
/// 因此 <b>只存一份</b>，不再像老格式那样在 meta 里存两份（S-285 §二 的 6,619 KB × 2）。</para>
/// </summary>
public static class DbMessageParts
{
    /// <summary>
    /// kind 值域。与 <c>types.ts</c> 的 <c>ContentSegment['type']</c> 一一对应。
    /// </summary>
    public static class Kinds
    {
        public const string Thinking = "thinking";
        public const string Text = "text";
        public const string ToolUse = "tool_use";
    }

    /// <summary>
    /// 段在本 iteration 段组内的固定次序 —— 与渲染侧 <c>stream-segments.ts</c> 的
    /// <c>SEGMENT_KIND_ORDER</c>（thinking:0 / text:1 / tool_use:2）逐值对应。
    /// </summary>
    private static int KindOrder(string kind) => kind switch
    {
        Kinds.Thinking => 0,
        Kinds.Text => 1,
        Kinds.ToolUse => 2,
        _ => 9
    };

    /// <summary>
    /// seq 编码 —— <b>锁死，不许改成「数组下标」或「端点追加」</b>。
    ///
    /// <para><c>seq = iteration * 1000 + kindOrder * 100 + ordinal</c></para>
    ///
    /// <para><b>为什么不能用数组下标</b>：<c>stream-segments.ts:63</c> 有
    /// <c>segments.splice(at, 0, seg)</c> —— 插入会移位下标。段的身份是
    /// <c>(iteration, type)</c>（<c>stream-segments.ts:6-7</c>），不是位置。</para>
    ///
    /// <para><b>为什么这个编码稳定</b>：同一 iteration 内 thinking / text 各只有一个槽
    /// （<c>findSegmentSlot</c> 按 iteration+type 找），ordinal 恒为 0；同轮内多个
    /// tool_use「保持到达顺序，新段排在最后一个同类段之后」（只追加），ordinal 因此单调。
    /// ⇒ <b>同一个 toolCallId 永远映射到同一个 seq</b>，状态更新走
    /// <c>INSERT OR REPLACE (message_id, seq)</c> 原地覆盖单行，不会漂成两行。</para>
    ///
    /// <para><b>上限不是 99，是 799</b>：<c>kindOrder * 100 + ordinal</c> 最大 299，撞上下一轮
    /// 的 thinking（<c>(iteration+1) * 1000 + 0</c>）发生在 <c>ordinal = 800</c>。
    /// 这里 clamp 到 99 是<b>保守取值</b>——同一轮 99 个并行工具已远超实际观测，
    /// 不是编码的硬边界。真要突破 99，把 clamp 上限提到 799 即可，编码本身不用动。</para>
    ///
    /// <para><b>clamp 的代价（别踩）</b>：超过 99 的 ordinal 会被压到 99，
    /// 于是两个不同工具拿到同一个 seq，<c>INSERT OR REPLACE</c> 会静默吞掉一段。
    /// 缺 <c>iteration</c> 的老段因此不能走这条（会共用第 1 轮的 ordinal 计数），
    /// 走 <see cref="EncodeFallbackSeq"/> 的负区间。</para>
    /// </summary>
    public static long EncodeSeq(int iteration, string kind, int ordinal)
    {
        var safeIteration = Math.Max(0, iteration);
        var safeOrdinal = Math.Clamp(ordinal, 0, 99);
        return (long)safeIteration * 1000L + KindOrder(kind) * 100L + safeOrdinal;
    }

    /// <summary>
    /// 段没有合法 <c>iteration</c> 时的保序兜底 seq —— <b>负区间</b>。
    ///
    /// <para>取值 <c>FallbackSeqBase + arrayIndex</c>，<c>FallbackSeqBase = -1_000_000_000</c>：
    /// 全部真实段的 seq 都 <c>&gt;= 0</c>，所以缺 iteration 的段整体排在它们之前，
    /// 内部按 segments 数组的原始先后保序。</para>
    ///
    /// <para><b>为什么不用 iteration = 0 或 1 了事</b>：那会把老段塞进真实轮次的区间，
    /// 与真实第 N 轮的 ordinal 计数互相顶撞；撞满 clamp 后 seq 重复，
    /// <c>INSERT OR REPLACE</c> 直接覆盖掉一段，信息静默丢失。</para>
    ///
    /// <para><b>已知取舍（混排坏数据）</b>：一条消息里若有段带 iteration、有段不带，
    /// 缺的那些会全部排到最前面，整体顺序与原始数组未必一致。真实数据里
    /// <c>stream-segments.ts</c> 建段必带 iteration，全缺或全有是常态；
    /// 混排只可能是历史脏数据，此时「不丢 + 内部保序」优先于「绝对时序正确」。</para>
    /// </summary>
    public static long EncodeFallbackSeq(int arrayIndex)
    {
        return FallbackSeqBase + arrayIndex;
    }

    /// <summary>保序兜底 seq 的区间起点，见 <see cref="EncodeFallbackSeq"/>。</summary>
    private const long FallbackSeqBase = -1_000_000_000L;

    /// <summary>一行 parts（读出来的形状）。</summary>
    public readonly record struct PartRow(long Seq, string Kind, string Payload);

    // ─── 判据 ───

    /// <summary>
    /// 这段 meta 里是否带块结构（<c>segments</c> 或 <c>toolCalls</c> 非空数组）。
    ///
    /// <para>这是 S-285 §8.3 的分流判据，<b>读的是库里这一行自己的 meta</b>：
    /// 有 ⇒ 老格式，继续整行 upsert、原样写回、一个字节不变；
    /// 无 ⇒ 新格式，块结构写 parts。</para>
    /// </summary>
    public static bool HasBlockStructure(string? metaJson)
    {
        if (string.IsNullOrEmpty(metaJson)) return false;
        try
        {
            using var doc = JsonDocument.Parse(metaJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return false;

            if (root.TryGetProperty("segments", out var segments) &&
                segments.ValueKind == JsonValueKind.Array &&
                segments.GetArrayLength() > 0)
            {
                return true;
            }

            return root.TryGetProperty("toolCalls", out var toolCalls) &&
                   toolCalls.ValueKind == JsonValueKind.Array &&
                   toolCalls.GetArrayLength() > 0;
        }
        catch
        {
            return false;
        }
    }

    // ─── 拆分：meta → (剥离后的 meta, parts) ───

    /// <summary>
    /// 把 meta 里的块结构剥出来，返回「不含 segments/toolCalls 的 meta」+「要写进 parts 的行」。
    ///
    /// <para>除 segments / toolCalls 之外的字段（thinking、error、preToolPhase、content、
    /// compressionStatus 等）一律原样保留 —— 这些不属于块结构，动了就是改语义。</para>
    ///
    /// <para>顶层 <c>thinking</c> 刻意留在 meta：它是整条消息的思考汇总（用于折叠显示），
    /// 与 segments 里按轮的 thinking 段语义不同，不是冗余。</para>
    /// </summary>
    public static (string? StrippedMeta, List<PartRow> Parts) SplitMeta(string? metaJson, long createdAt)
    {
        var parts = new List<PartRow>();
        if (string.IsNullOrEmpty(metaJson)) return (metaJson, parts);

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(metaJson);
        }
        catch
        {
            // meta 不是合法 JSON —— 原样返回，不猜、不改。
            return (metaJson, parts);
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return (metaJson, parts);

            root.TryGetProperty("segments", out var segmentsEl);
            root.TryGetProperty("toolCalls", out var toolCallsEl);

            var hasSegments = segmentsEl.ValueKind == JsonValueKind.Array && segmentsEl.GetArrayLength() > 0;
            var hasToolCalls = toolCallsEl.ValueKind == JsonValueKind.Array && toolCallsEl.GetArrayLength() > 0;

            // 没有任何块结构 ⇒ 不是本表的事，原样返回。
            if (!hasSegments && !hasToolCalls) return (metaJson, parts);

            // segments 是权威时序骨架；只有 toolCalls 时才从它造段。
            parts = hasSegments
                ? PartsFromSegments(segmentsEl)
                : PartsFromToolCalls(toolCallsEl);

            // 重新拼 meta，只跳过这两个键，其余逐字节照抄。
            var buffer = new ArrayBufferWriter<byte>();
            using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions
            {
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
            }))
            {
                writer.WriteStartObject();
                foreach (var prop in root.EnumerateObject())
                {
                    if (prop.NameEquals("segments") || prop.NameEquals("toolCalls")) continue;
                    prop.WriteTo(writer);
                }
                writer.WriteEndObject();
            }

            var stripped = Encoding.UTF8.GetString(buffer.WrittenSpan);
            // 剥完只剩 "{}" ⇒ 存 null，与 serializeMessage 的「空 meta 存 null」口径一致。
            return (stripped == "{}" ? null : stripped, parts);
        }
    }

    /// <summary>
    /// 从 segments 数组生成 parts。ordinal 按「同 iteration 同 kind 的出现序号」分配 ——
    /// thinking/text 恒为 0，tool_use 按到达序递增，与 <c>EncodeSeq</c> 的稳定性前提一致。
    ///
    /// <para><b>缺 iteration 的段</b>走 <see cref="EncodeFallbackSeq"/>（负区间），
    /// 且<b>不参与 ordinal 计数</b>——否则会和真实第 1 轮抢同一个 key。</para>
    /// </summary>
    private static List<PartRow> PartsFromSegments(JsonElement segmentsEl)
    {
        var parts = new List<PartRow>();
        var ordinals = new Dictionary<(int, string), int>();
        var arrayIndex = 0;

        foreach (var seg in segmentsEl.EnumerateArray())
        {
            var index = arrayIndex++;
            if (seg.ValueKind != JsonValueKind.Object) continue;

            var kind = ReadString(seg, "type");
            if (kind is not (Kinds.Thinking or Kinds.Text or Kinds.ToolUse)) continue;

            // iteration 必须是正数才算合法。0 / 负数 / 缺失 / 非数字 ⇒ 老脏数据，走兜底。
            var iteration = ReadInt(seg, "iteration", 0);
            if (iteration <= 0)
            {
                parts.Add(new PartRow(EncodeFallbackSeq(index), kind, seg.GetRawText()));
                continue;
            }

            var key = (iteration, kind);
            var ordinal = ordinals.TryGetValue(key, out var seen) ? seen : 0;
            ordinals[key] = ordinal + 1;

            parts.Add(new PartRow(EncodeSeq(iteration, kind, ordinal), kind, seg.GetRawText()));
        }

        // 兜底段 seq 是负数、正常段是正数 ⇒ 兜底段天然排在前，符合 EncodeFallbackSeq 的约定。
        return parts;
    }

    /// <summary>
    /// 只有 toolCalls、没有 segments 的老数据：造出等价的 tool_use 段，保住信息不丢。
    ///
    /// <para><b>seq 走保序兜底（负区间），不走 <c>EncodeSeq(1, ...)</c></b>：
    /// 老消息的工具调用次数可以远超 99（实测一条 148 次），而 <c>EncodeSeq</c> 会把
    /// ordinal clamp 到 99 ⇒ 第 100 个之后全部撞同一个 seq ⇒ <c>INSERT OR REPLACE</c>
    /// 静默吞段。这条路径本来就没有轮次信息，数组顺序就是唯一时序，兜底正合适。</para>
    /// </summary>
    private static List<PartRow> PartsFromToolCalls(JsonElement toolCallsEl)
    {
        var parts = new List<PartRow>();
        var arrayIndex = 0;

        foreach (var call in toolCallsEl.EnumerateArray())
        {
            var index = arrayIndex++;
            if (call.ValueKind != JsonValueKind.Object) continue;

            var buffer = new ArrayBufferWriter<byte>();
            using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions
            {
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
            }))
            {
                writer.WriteStartObject();
                writer.WriteString("type", Kinds.ToolUse);
                // 0 = 轮次未知（老数据只有 toolCalls，没有轮次信息）。真实轮次从 1 起，不会混。
                // 渲染端 ContentSegment.iteration 是必填 number，写 0 保持形状不破；
                // 唯一的消费者 InputArea/utils.ts:167 用 (seg.iteration ?? 1)，走不到 0 这条。
                writer.WriteNumber("iteration", 0);
                WriteIfPresent(writer, "toolCallId", call, "id");
                WriteIfPresent(writer, "toolName", call, "name");
                WriteRawIfPresent(writer, "input", call, "input");
                WriteIfPresent(writer, "status", call, "status");
                WriteIfPresent(writer, "output", call, "output");
                WriteIfPresent(writer, "error", call, "error");
                WriteRawIfPresent(writer, "startedAt", call, "startedAt");
                WriteRawIfPresent(writer, "completedAt", call, "completedAt");
                writer.WriteEndObject();
            }

            parts.Add(new PartRow(
                EncodeFallbackSeq(index),
                Kinds.ToolUse,
                Encoding.UTF8.GetString(buffer.WrittenSpan)));
        }

        return parts;
    }

    // ─── 写入 ───

    /// <summary>
    /// 把 parts 写进库。<b>整条消息先删后写</b>（S-285 §4.4 选项 A + S-247 复审补刀）。
    ///
    /// <para>只 <c>INSERT OR REPLACE</c> 是不够的：<see cref="SplitMeta"/> 每次都按当前 meta
    /// <b>全量重算</b> seq 集合，而集合只会因为「段被合并 / 被裁掉」而变小。变小时旧行不会被
    /// 覆盖，<see cref="MergePartsIntoMeta"/> 又把库里所有行都当活段读回 —— 同一段就会在
    /// meta.segments 里出现两遍。f0f9ccaf 修的是同一根因的另一半（undo clamp 吞段），
    /// 这半一直没补。</para>
    ///
    /// <para>选「先删再写」而不是「算差集删」：本函数本来每次就把所有行全量写一遍
    /// （没变的行也走 <c>REPLACE</c>），增量只有一条 DELETE，逻辑不用猜，也不会因为
    /// seq 拼参超过 SQLite 的 999 参数上限。</para>
    ///
    /// <para><c>parts</c> 为空时只删不插 —— 那代表当前 meta 里已经没有块结构（<see cref="SplitMeta"/>
    /// 的空返回），旧行留着就是幽灵段。老格式消息本就没有 parts 行，DELETE 空转无害。</para>
    /// </summary>
    public static void WriteParts(
        SqliteConnection conn,
        SqliteTransaction tx,
        string messageId,
        IReadOnlyList<PartRow> parts,
        long createdAt)
    {
        using (var del = conn.CreateCommand())
        {
            del.Transaction = tx;
            del.CommandText = "DELETE FROM message_parts WHERE message_id = @mid";
            del.Parameters.Add(new SqliteParameter("@mid", messageId));
            del.ExecuteNonQuery();
        }

        if (parts.Count == 0) return;

        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText =
            "INSERT OR REPLACE INTO message_parts (message_id, seq, kind, payload, created_at) " +
            "VALUES (@mid, @seq, @kind, @payload, @ca)";

        var pMid = cmd.Parameters.Add("@mid", SqliteType.Text);
        var pSeq = cmd.Parameters.Add("@seq", SqliteType.Integer);
        var pKind = cmd.Parameters.Add("@kind", SqliteType.Text);
        var pPayload = cmd.Parameters.Add("@payload", SqliteType.Text);
        var pCa = cmd.Parameters.Add("@ca", SqliteType.Integer);

        pMid.Value = messageId;
        pCa.Value = createdAt;

        foreach (var part in parts)
        {
            pSeq.Value = part.Seq;
            pKind.Value = part.Kind;
            pPayload.Value = part.Payload;
            cmd.ExecuteNonQuery();
        }
    }

    // ─── 读取 ───

    /// <summary>
    /// 按 message_id 批量取 parts（自带连接）。读侧各 list 端点走这条。
    /// </summary>
    public static Dictionary<string, List<PartRow>> LoadParts(
        DbService db,
        IReadOnlyList<string> messageIds)
    {
        if (messageIds.Count == 0) return new Dictionary<string, List<PartRow>>(StringComparer.Ordinal);
        using var conn = db.CreateConnection();
        return LoadParts(conn, messageIds);
    }

    /// <summary>
    /// 按 message_id 批量取 parts，按 seq 升序。窗口大小由调用方的 turns 锁定，量固定。
    /// </summary>
    public static Dictionary<string, List<PartRow>> LoadParts(
        SqliteConnection conn,
        IReadOnlyList<string> messageIds)
    {
        var result = new Dictionary<string, List<PartRow>>(StringComparer.Ordinal);
        if (messageIds.Count == 0) return result;

        // SQLite 的参数上限是 999；窗口内消息数远小于此，但按 500 分批更稳。
        const int batchSize = 500;
        for (var offset = 0; offset < messageIds.Count; offset += batchSize)
        {
            var batch = messageIds.Skip(offset).Take(batchSize).ToList();
            var placeholders = string.Join(",", batch.Select((_, i) => $"@id{i}"));

            using var cmd = conn.CreateCommand();
            cmd.CommandText =
                $"SELECT message_id, seq, kind, payload FROM message_parts " +
                $"WHERE message_id IN ({placeholders}) ORDER BY message_id, seq";
            for (var i = 0; i < batch.Count; i++)
            {
                cmd.Parameters.AddWithValue($"@id{i}", batch[i]);
            }

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var messageId = reader.GetString(0);
                var seq = reader.GetInt64(1);
                var kind = reader.GetString(2);
                var payload = reader.GetString(3);

                if (!result.TryGetValue(messageId, out var list))
                {
                    list = new List<PartRow>();
                    result[messageId] = list;
                }
                list.Add(new PartRow(seq, kind, payload));
            }
        }

        return result;
    }

    /// <summary>
    /// 把 parts 合并回 meta —— 对外形状仍是 <c>{ toolCalls, segments, thinking }</c>，
    /// 渲染层零改动（S-285 §4.3）。
    ///
    /// <para><b>本方法只按 <c>parts</c> 的入参顺序写回，不解析 seq 的任何数字含义。</b>
    /// seq 的编码（<see cref="EncodeSeq"/>）是渲染端的时序规则，C# 只在
    /// 「迁移老 meta」这一条路径上造 seq（<see cref="SplitMeta"/>），正常写入由 TS 侧算。
    /// 读回来时 <see cref="LoadParts"/> 已 <c>ORDER BY seq</c>，这里顺序即时序 ——
    /// 若在这里按 kind 分组或解读 iteration，就等于把渲染端的规则复制一份到 C#，
    /// 重演 S-276「四处判据各写各的」的坑。</para>
    ///
    /// <para>没有 parts 的消息原样返回 meta（老格式走这条）。</para>
    /// </summary>
    public static string? MergePartsIntoMeta(string? metaJson, IReadOnlyList<PartRow> parts)
    {
        if (parts.Count == 0) return metaJson;

        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        }))
        {
            writer.WriteStartObject();

            // 先照抄原 meta 的其余字段（新格式下这里已经没有 segments/toolCalls）。
            if (!string.IsNullOrEmpty(metaJson))
            {
                try
                {
                    using var doc = JsonDocument.Parse(metaJson);
                    if (doc.RootElement.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var prop in doc.RootElement.EnumerateObject())
                        {
                            if (prop.NameEquals("segments") || prop.NameEquals("toolCalls")) continue;
                            prop.WriteTo(writer);
                        }
                    }
                }
                catch
                {
                    // meta 坏了也不能丢 parts —— 继续往下写块结构。
                }
            }

            // segments：按 seq 升序原样写回。
            writer.WritePropertyName("segments");
            writer.WriteStartArray();
            foreach (var part in parts)
            {
                try
                {
                    using var payloadDoc = JsonDocument.Parse(part.Payload);
                    payloadDoc.RootElement.WriteTo(writer);
                }
                catch
                {
                    // 单行 payload 坏了就跳过，不拖垮整条消息。
                }
            }
            writer.WriteEndArray();

            // toolCalls：从 tool_use 段重建（字段完全重叠，不再单独存一份）。
            writer.WritePropertyName("toolCalls");
            writer.WriteStartArray();
            foreach (var part in parts)
            {
                if (part.Kind != Kinds.ToolUse) continue;
                try
                {
                    using var payloadDoc = JsonDocument.Parse(part.Payload);
                    WriteToolCallFromSegment(writer, payloadDoc.RootElement);
                }
                catch
                {
                    // 同上：单段坏了跳过。
                }
            }
            writer.WriteEndArray();

            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }

    /// <summary>tool_use 段 → 老格式的 ToolCallInfo 形状。</summary>
    private static void WriteToolCallFromSegment(Utf8JsonWriter writer, JsonElement seg)
    {
        writer.WriteStartObject();
        WriteIfPresent(writer, "id", seg, "toolCallId");
        WriteIfPresent(writer, "name", seg, "toolName");
        WriteRawIfPresent(writer, "input", seg, "input");
        WriteIfPresent(writer, "status", seg, "status");
        WriteIfPresent(writer, "output", seg, "output");
        WriteIfPresent(writer, "error", seg, "error");
        WriteRawIfPresent(writer, "startedAt", seg, "startedAt");
        WriteRawIfPresent(writer, "completedAt", seg, "completedAt");
        writer.WriteEndObject();
    }

    // ─── 删除（显式清，不加 FK —— S-285 §8.5） ───

    public static void DeleteForMessage(
        SqliteConnection conn,
        SqliteTransaction tx,
        string messageId)
    {
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "DELETE FROM message_parts WHERE message_id = @mid";
        cmd.Parameters.AddWithValue("@mid", messageId);
        cmd.ExecuteNonQuery();
    }

    /// <summary>
    /// 按会话清 —— parts 表里不存 session_id（避免两份真相，§8.2），
    /// 所以先由 messages 取该会话的全部 message_id 再删。
    /// </summary>
    public static void DeleteForSession(
        SqliteConnection conn,
        SqliteTransaction tx,
        string sessionId)
    {
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText =
            "DELETE FROM message_parts WHERE message_id IN " +
            "(SELECT id FROM messages WHERE session_id = @sid)";
        cmd.Parameters.AddWithValue("@sid", sessionId);
        cmd.ExecuteNonQuery();
    }

    // ─── 小工具 ───

    private static string? ReadString(JsonElement obj, string name)
    {
        return obj.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString()
            : null;
    }

    private static int ReadInt(JsonElement obj, string name, int fallback)
    {
        return obj.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.Number
            ? el.GetInt32()
            : fallback;
    }

    private static void WriteIfPresent(Utf8JsonWriter writer, string outName, JsonElement src, string srcName)
    {
        if (!src.TryGetProperty(srcName, out var el) || el.ValueKind == JsonValueKind.Null) return;
        if (el.ValueKind == JsonValueKind.String)
        {
            writer.WriteString(outName, el.GetString());
        }
    }

    private static void WriteRawIfPresent(Utf8JsonWriter writer, string outName, JsonElement src, string srcName)
    {
        if (!src.TryGetProperty(srcName, out var el) || el.ValueKind == JsonValueKind.Null) return;
        writer.WritePropertyName(outName);
        el.WriteTo(writer);
    }
}
