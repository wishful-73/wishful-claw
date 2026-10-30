/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;

namespace WishfulClaw.Agent.Modules.Extensions;

public sealed record NativeExtensionToolExecutionResult(bool Success, string? Content, string? Error);

public sealed record NativeExtensionInstance(
    string Id,
    bool Enabled,
    IReadOnlyDictionary<string, string> Config,
    NativeExtensionManifest Manifest);

public sealed record NativeExtensionManifest(
    int SchemaVersion,
    string Id,
    string Name,
    string Version,
    IReadOnlyList<NativeExtensionConfigField> ConfigSchema,
    IReadOnlyList<string> NetworkPermissions,
    IReadOnlyList<NativeExtensionToolDefinition> Tools,
    IReadOnlyList<NativeExtensionViewDefinition> Views,
    IReadOnlyList<NativeExtensionAssetDefinition> Assets);

/// <summary>
/// 插件视图（S-240）。只保留主程序真正要用的字段：
/// 导轨显示名 / 排序 / 窗口尺寸交给渲染端在原生 manifest 里取，这里只为「两份模型不漂移」留最小集。
/// </summary>
public sealed record NativeExtensionViewDefinition(
    string Id,
    string Title,
    string Entry,
    int NavOrder);

/// <summary>
/// 需要下载的资产声明（S-240）。只有 id —— URL / 体积 / 哈希归主程序内置表（S-242）。
/// </summary>
public sealed record NativeExtensionAssetDefinition(
    string Id,
    bool Optional);

public sealed record NativeExtensionConfigField(
    string Key,
    string Type,
    string? DefaultValue);

public sealed record NativeExtensionToolDefinition(
    string Name,
    string Kind,
    NativeExtensionHttpDefinition? Http,
    string? Handler);

public sealed record NativeExtensionHttpDefinition(
    string Method,
    string Url,
    IReadOnlyDictionary<string, string> Headers,
    JsonElement? Body);
