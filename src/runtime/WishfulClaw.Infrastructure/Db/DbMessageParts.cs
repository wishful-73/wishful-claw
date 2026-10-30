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
    /// <para>上限：iteration 到 2,147,483 轮，ordinal 到 99（同轮 99 个并行工具已远超实际）。</para>
    /// </summary>
    public static long EncodeSeq(int iteration, string kind, int ordinal)
    {
        var safeIteration = Math.Max(0, iteration);
        var safeOrdinal = Math.Clamp(ordinal, 0, 99);
        return (long)safeIteration * 1000L + KindOrder(kind) * 100L + safeOrdinal;
    }

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
    /// </summary>
    private static List<PartRow> PartsFromSegments(JsonElement segmentsEl)
    {
        var parts = new List<PartRow>();
        var ordinals = new Dictionary<(int, string), int>();

        foreach (var seg in segmentsEl.EnumerateArray())
        {
            if (seg.ValueKind != JsonValueKind.Object) continue;

            var kind = ReadString(seg, "type");
            if (kind is not (Kinds.Thinking or Kinds.Text or Kinds.ToolUse)) continue;

            var iteration = ReadInt(seg, "iteration", 1);
            var key = (iteration, kind);
            var ordinal = ordinals.TryGetValue(key, out var seen) ? seen : 0;
            ordinals[key] = ordinal + 1;

            parts.Add(new PartRow(EncodeSeq(iteration, kind, ordinal), kind, seg.GetRawText()));
        }

        return parts;
    }

    /// <summary>
    /// 只有 toolCalls、没有 segments 的老数据：造出等价的 tool_use 段，保住信息不丢。
    /// </summary>
    private static List<PartRow> PartsFromToolCalls(JsonElement toolCallsEl)
    {
        var parts = new List<PartRow>();
        var ordinal = 0;

        foreach (var call in toolCallsEl.EnumerateArray())
        {
            if (call.ValueKind != JsonValueKind.Object) continue;

            var buffer = new ArrayBufferWriter<byte>();
            using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions
            {
                Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
            }))
            {
                writer.WriteStartObject();
                writer.WriteString("type", Kinds.ToolUse);
                writer.WriteNumber("iteration", 1);
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
                EncodeSeq(1, Kinds.ToolUse, ordinal),
                Kinds.ToolUse,
                Encoding.UTF8.GetString(buffer.WrittenSpan)));
            ordinal++;
        }

        return parts;
    }

    // ─── 写入 ───

    /// <summary>
    /// 把 parts 写进库。<b>逐行 <c>INSERT OR REPLACE</c></b> —— 同一 (message_id, seq)
    /// 原地覆盖，绝不追加新行（S-285 §4.4 选项 A）。
    /// </summary>
    public static void WriteParts(
        SqliteConnection conn,
        SqliteTransaction tx,
        string messageId,
        IReadOnlyList<PartRow> parts,
        long createdAt)
    {
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
