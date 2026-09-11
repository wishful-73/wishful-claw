/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Collections.Concurrent;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Plan mode executor — EnterPlanMode / ExitPlanMode / UpdatePlanStep.
/// File-based plan storage in .wishful-claw/plans/ + DB metadata in plans table.
/// Sends plan/ui-update reverse requests to the renderer for real-time UI sync.
/// </summary>
public static partial class AgentRuntimePlanExecutor
{
    private const string IdAlphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private static readonly HashSet<string> PlanToolNames = new(StringComparer.Ordinal)
    {
        "EnterPlanMode", "SubmitPlanReview", "UpdatePlanStep", "ExitPlanMode"
    };

    private static readonly ConcurrentDictionary<string, PlanRunState> RunStates = new(StringComparer.Ordinal);
    private static readonly ConcurrentDictionary<string, string> SessionPlans = new(StringComparer.Ordinal);

    public static bool IsPlanTool(string toolName)
    {
        return PlanToolNames.Contains(toolName);
    }

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        string runId,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        return call.Name switch
        {
            "EnterPlanMode" => await EnterPlanModeAsync(call.Input, parameters, runId, context, cancellationToken),
            "SubmitPlanReview" => await SubmitPlanReviewAsync(parameters, runId, context, cancellationToken),
            "ExitPlanMode" => await ExitPlanModeAsync(parameters, runId, context, cancellationToken),
            "UpdatePlanStep" => await UpdatePlanStepAsync(call.Input, parameters, runId, context, cancellationToken),
            _ => EncodeError($"Native plan tool not registered: {call.Name}")
        };
    }

    public static void ClearRun(string runId)
    {
        RunStates.TryRemove(runId, out _);
    }

    public static bool IsPlanModeActiveForRun(string runId, JsonElement parameters)
    {
        if (RunStates.TryGetValue(runId, out var state) && state.Active)
        {
            return true;
        }
        return JsonHelpers.GetBool(parameters, "planMode", false);
    }

    // ── EnterPlanMode ──

    private static async Task<string> EnterPlanModeAsync(
        JsonElement input,
        JsonElement parameters,
        string runId,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim() ?? string.Empty;
        if (sessionId.Length == 0)
        {
            return EncodeError("No active session.");
        }

        var workingFolder = JsonHelpers.GetString(parameters, "workingFolder")?.Trim() ?? string.Empty;
        if (workingFolder.Length == 0)
        {
            return EncodeError("Plan mode requires an active working folder.");
        }

        string status;
        string planId;
        string planFilePath;

        // Check for existing draft plan in DB
        var existingPlan = LoadPlanBySession(parameters, sessionId);
        if (existingPlan is { FilePath.Length: > 0 } && IsDraftPlanStatus(existingPlan.Status))
        {
            planFilePath = existingPlan.FilePath!;
            planId = existingPlan.Id;
            status = "resumed";
        }
        else
        {
            var reason = JsonHelpers.GetString(input, "reason")?.Trim();
            if (string.IsNullOrEmpty(reason))
            {
                reason = "Implementation planning";
            }
            planId = CreatePlanId();
            planFilePath = GetPlanFilePath(workingFolder, planId);
            var now = Now();
            InsertPlan(parameters, new PlanEntity
            {
                Id = planId,
                SessionId = sessionId,
                Title = reason,
                Status = "drafting",
                FilePath = planFilePath,
                Content = null,
                SpecJson = null,
                CreatedAt = now,
                UpdatedAt = now
            });
            SessionPlans[sessionId] = planFilePath;
            status = "entered";
        }

        // Ensure plan directory + file exist
        try
        {
            var planDir = Path.Combine(workingFolder, WishfulClawPaths.DataDirName, "plans");
            Directory.CreateDirectory(planDir);
            if (!File.Exists(planFilePath))
            {
                await File.WriteAllTextAsync(planFilePath, string.Empty, cancellationToken);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            if (status == "entered")
            {
                DeletePlan(parameters, planId);
            }
            return EncodeError(ex.Message);
        }

        RunStates[runId] = new PlanRunState(true, planFilePath);

        // Notify frontend
        var planRow = LoadPlanById(parameters, planId);
        if (planRow != null)
        {
            await NotifyPlanUiAsync("enter", planRow, null, parameters, context, cancellationToken);
        }

        return EncodeJsonObject(writer =>
        {
            writer.WriteString("status", status);
            writer.WriteString("plan_id", planId);
            writer.WriteString("plan_file_path", planFilePath);
            writer.WriteString(
                "message",
                status == "resumed"
                    ? "Resumed plan draft. Follow the plan mode workflow:\n\nPLANNING PHASE (you are here):\n1. COMMUNICATE: Understand what the user wants. Ask clarifying questions about scope, constraints, and expected outcome. Use AskUserQuestion if needed. Do NOT start exploring until you have a clear picture of the requirements.\n2. EXPLORE: Read the codebase (Read/Glob/Grep) to understand project structure, existing code, and dependencies. Run read-only commands (git status, git log) to check state.\n3. PLAN: Write the plan file with: task target, step checklist (each step MUST have a verification checkpoint), involved files/modules, and reference source paths.\n4. SUBMIT: Call SubmitPlanReview to submit the plan for user review. Wait for the user to approve or request adjustments.\n\nEXECUTION PHASE (after user approves):\n5. EXECUTE: Use Task tool (background=false) to dispatch foreground sub-agents for each step. Each sub-agent implements, runs mini-verification, and commits. One commit per step. Do NOT push.\n6. REVIEW: Dispatch a review sub-agent to check code quality, layer conventions, and error handling.\n7. VERIFY: Run final verification. Report results and STOP for user to confirm PASS/FAIL/PARTIAL.\n\nDo NOT write implementation code during planning. You can read files, write/edit documents, and run read-only commands only."
                    : "Plan mode activated. Follow the plan mode workflow:\n\nPLANNING PHASE (you are here):\n1. COMMUNICATE: Understand what the user wants. Ask clarifying questions about scope, constraints, and expected outcome. Use AskUserQuestion if needed. Do NOT start exploring until you have a clear picture of the requirements.\n2. EXPLORE: Read the codebase (Read/Glob/Grep) to understand project structure, existing code, and dependencies. Run read-only commands (git status, git log) to check state.\n3. PLAN: Write the plan file with: task target, step checklist (each step MUST have a verification checkpoint), involved files/modules, and reference source paths.\n4. SUBMIT: Call SubmitPlanReview to submit the plan for user review. Wait for the user to approve or request adjustments.\n\nEXECUTION PHASE (after user approves):\n5. EXECUTE: Use Task tool (background=false) to dispatch foreground sub-agents for each step. Each sub-agent implements, runs mini-verification, and commits. One commit per step. Do NOT push.\n6. REVIEW: Dispatch a review sub-agent to check code quality, layer conventions, and error handling.\n7. VERIFY: Run final verification. Report results and STOP for user to confirm PASS/FAIL/PARTIAL.\n\nDo NOT write implementation code during planning. You can read files, write/edit documents, and run read-only commands only.");
        });
    }

    // ── SubmitPlanReview ──

    private static async Task<string> SubmitPlanReviewAsync(
        JsonElement parameters,
        string runId,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim() ?? string.Empty;
        if (sessionId.Length == 0)
        {
            return EncodeError("No active session.");
        }

        var plan = LoadPlanBySession(parameters, sessionId);
        if (plan is not { FilePath.Length: > 0 })
        {
            return EncodeJsonObject(writer =>
            {
                writer.WriteString("status", "not_in_plan_mode");
                writer.WriteString("message", "You are not currently in plan mode.");
            });
        }

        // Always re-read the plan file and re-submit for review.
        // (Previously returned early if status was already "awaiting_review",
        //  but that prevented re-submission after the user rejected the plan.)

        // Read plan file content (with retry — file may still be locked by a recent Write)
        string? content = null;
        try
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                try
                {
                    content = await File.ReadAllTextAsync(plan.FilePath!, cancellationToken);
                    break;
                }
                catch (IOException) when (attempt < 2 && !cancellationToken.IsCancellationRequested)
                {
                    await Task.Delay(100 * (attempt + 1), cancellationToken);
                }
            }
            content ??= await File.ReadAllTextAsync(plan.FilePath!, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return EncodeError($"Failed to read the current plan file before exiting plan mode: {ex.Message}");
        }

        if (string.IsNullOrWhiteSpace(content))
        {
            return EncodeError("Plan file is empty. Write the plan file before exiting plan mode.");
        }

        var title = InferTitleFromContent(content);
        var now = Now();
        UpdatePlanForReview(parameters, plan.Id, title, now);

        // Read existing steps (if any) to avoid clearing them on re-submission
        var existingState = await ReadStateFileAsync(plan.FilePath!, cancellationToken);
        var existingSteps = existingState?.Steps ?? [];
        // Write state file with "awaiting_review" status, preserving existing steps
        await WriteStateFileAsync(plan.FilePath!, plan.Id, title, "awaiting_review", existingSteps, cancellationToken);

        RunStates[runId] = new PlanRunState(false, plan.FilePath);

        // Notify frontend — plan is under review, do NOT exit plan mode yet
        var updatedPlan = LoadPlanById(parameters, plan.Id);
        if (updatedPlan != null)
        {
            await NotifyPlanUiAsync("review", updatedPlan, content, parameters, context, cancellationToken);
        }

        // Send reverse request to renderer and wait for user review (like AskUserQuestion)
        var reviewRequest = CreateJsonElement(writer =>
        {
            writer.WriteString("planId", plan.Id);
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("title", title);
            writer.WriteString("filePath", plan.FilePath);
            writer.WriteString("content", content);
        });

        var reviewResponse = await AgentRuntimeReverseRequests.RequestAsync(
            context,
            "plan/review-request",
            reviewRequest,
            cancellationToken);

        // Parse user response
        bool approved = false;
        string feedback = "";
        bool newSession = false;
        bool cancelled = false;
        if (reviewResponse.ValueKind == JsonValueKind.Object)
        {
            if (reviewResponse.TryGetProperty("approved", out var approvedProp))
                approved = approvedProp.ValueKind == JsonValueKind.True;
            if (reviewResponse.TryGetProperty("feedback", out var feedbackProp) && feedbackProp.ValueKind == JsonValueKind.String)
                feedback = feedbackProp.GetString() ?? "";
            if (reviewResponse.TryGetProperty("newSession", out var newSessionProp))
                newSession = newSessionProp.ValueKind == JsonValueKind.True;
            if (reviewResponse.TryGetProperty("cancelled", out var cancelledProp))
                cancelled = cancelledProp.ValueKind == JsonValueKind.True;
        }

        if (cancelled)
        {
            UpdatePlanStatus(parameters, plan.Id, title, "cancelled", Now());
            var cancelState = await ReadStateFileAsync(plan.FilePath!, cancellationToken);
            var cancelSteps = cancelState?.Steps ?? [];
            await WriteStateFileAsync(plan.FilePath!, plan.Id, title, "cancelled", cancelSteps, cancellationToken);

            return EncodeJsonObject(writer =>
            {
                writer.WriteString("status", "cancelled");
                writer.WriteString("plan_id", plan.Id);
                writer.WriteString("message", "Plan mode cancelled by user. No further action needed.");
            });
        }

        if (approved)
        {
            // Update plan status to approved in DB
            UpdatePlanStatus(parameters, plan.Id, title, "approved", Now());

            // Update state.json to "approved", preserving existing steps
            var stateBeforeExec = await ReadStateFileAsync(plan.FilePath!, cancellationToken);
            var stepsBeforeExec = stateBeforeExec?.Steps ?? [];
            await WriteStateFileAsync(plan.FilePath!, plan.Id, title, "approved", stepsBeforeExec, cancellationToken);

            if (newSession)
            {
                return EncodeJsonObject(writer =>
                {
                    writer.WriteString("status", "approved");
                    writer.WriteString("plan_id", plan.Id);
                    writer.WriteString("plan_file_path", plan.FilePath);
                    writer.WriteString("message", "Plan approved and will be executed in a new session. No further action needed in this session.");
                });
            }

            return EncodeJsonObject(writer =>
            {
                writer.WriteString("status", "approved");
                writer.WriteString("plan_id", plan.Id);
                writer.WriteString("plan_file_path", plan.FilePath);
                writer.WriteString("title", title);
                writer.WriteString("content", content);
                writer.WriteString("message", "Plan approved. The plan file is at: " + plan.FilePath + ". Execute the development workflow:\n\n1. EXECUTE: For each step in the plan:\n  (a) Call UpdatePlanStep to mark it in_progress.\n  (b) Use the Task tool with subagent_type \"custom\" and background=false to dispatch a foreground sub-agent with a self-contained prompt for that step. The sub-agent should: implement the step, run mini-verification appropriate for the task (e.g. compile, lint, or test), and commit if it passes.\n  (c) When the sub-agent returns, call UpdatePlanStep to mark completed or failed.\n  (d) If a step fails, git reset to the last good commit, fix, and retry (max 3 retries before asking the user).\n\n2. REVIEW: After all steps complete, dispatch a review sub-agent to check: code matches plan target, layer conventions (AGENTS.md), no hardcoded paths/keys, error handling is sufficient.\n\n3. VERIFY: Run final compilation — dotnet build + npx tsc --noEmit for all tsconfig configs. Report results and STOP for user to confirm PASS/FAIL/PARTIAL.\n\nRules: One commit per step. Do NOT push until user confirms PASS. Only commit, never push during execution." );
            });
        }
        else
        {
            // Plan rejected — update status and let agent revise
            UpdatePlanStatus(parameters, plan.Id, title, "rejected", Now());

            return EncodeJsonObject(writer =>
            {
                writer.WriteString("status", "rejected");
                writer.WriteString("plan_id", plan.Id);
                writer.WriteString("plan_file_path", plan.FilePath);
                writer.WriteString("feedback", feedback);
                writer.WriteString("message", "Plan rejected. Feedback: " + feedback + ". Revise the plan file based on the feedback — adjust steps, checkpoints, or file paths as needed. Then call SubmitPlanReview again to re-submit for review.");
            });
        }
    }

    // ── ExitPlanMode (cancel) ──

    private static async Task<string> ExitPlanModeAsync(
        JsonElement parameters,
        string runId,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim() ?? string.Empty;
        if (sessionId.Length == 0)
        {
            return EncodeError("No active session.");
        }

        var plan = LoadPlanBySession(parameters, sessionId);
        if (plan is not { FilePath.Length: > 0 })
        {
            return EncodeJsonObject(writer =>
            {
                writer.WriteString("status", "not_in_plan_mode");
                writer.WriteString("message", "You are not currently in plan mode.");
            });
        }

        // Determine exit status (default: cancelled)
        var exitStatus = "cancelled";

        // Mark plan status in DB
        UpdatePlanStatus(parameters, plan.Id, plan.Title, exitStatus, Now());

        // Update state file
        var existingState = await ReadStateFileAsync(plan.FilePath!, cancellationToken);
        var existingSteps = existingState?.Steps ?? [];
        await WriteStateFileAsync(plan.FilePath!, plan.Id, plan.Title, exitStatus, existingSteps, cancellationToken);

        RunStates[runId] = new PlanRunState(false, plan.FilePath);

        // Notify frontend to exit plan mode
        var updatedPlan = LoadPlanById(parameters, plan.Id);
        if (updatedPlan != null)
        {
            await NotifyPlanUiAsync("exit", updatedPlan, null, parameters, context, cancellationToken);
        }

        return EncodeJsonObject(writer =>
        {
            writer.WriteString("status", exitStatus);
            writer.WriteString("plan_id", plan.Id);
            writer.WriteString("message", exitStatus == "completed"
                ? "Plan completed successfully (Goal mode)."
                : exitStatus == "failed"
                    ? "Plan failed (Goal mode). See state file for details."
                    : "Plan mode exited. The plan has been cancelled.");
        });
    }

    // ── UpdatePlanStep ──

    private static async Task<string> UpdatePlanStepAsync(
        JsonElement input,
        JsonElement parameters,
        string runId,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim() ?? string.Empty;
        if (sessionId.Length == 0)
        {
            return EncodeError("No active session.");
        }

        var plan = LoadPlanBySession(parameters, sessionId);
        if (plan is not { FilePath.Length: > 0 })
        {
            return EncodeError("No active plan for this session. Call EnterPlanMode first.");
        }

        // Parse step update from input
        var stepId = input.TryGetProperty("stepId", out var sidEl) && sidEl.ValueKind == JsonValueKind.Number
            ? sidEl.GetInt32()
            : 0;

        var stepTitle = JsonHelpers.GetString(input, "title")?.Trim() ?? $"Step {stepId}";
        var stepStatus = JsonHelpers.GetString(input, "status")?.Trim() ?? "in_progress";
        var stepResult = JsonHelpers.GetString(parameters, "result");

        // Read current state file
        var stateFilePath = GetStateFilePath(plan.FilePath!);
        PlanState? state = null;
        if (File.Exists(stateFilePath))
        {
            try
            {
                var stateJson = await File.ReadAllTextAsync(stateFilePath, cancellationToken);
                state = JsonSerializer.Deserialize(stateJson, WorkerJsonHelper.GetTypeInfo<PlanState>());
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                WorkerLog.Warn($"Failed to read plan state file: {ex.Message}");
            }
        }

        state ??= new PlanState
        {
            PlanId = plan.Id,
            Title = plan.Title,
            Status = "executing",
            Steps = [],
            UpdatedAt = Now()
        };

        // Update or add step
        var step = state.Steps.FirstOrDefault(s => s.Id == stepId);
        if (step == null)
        {
            // Auto-assign stepId if not provided
            if (stepId == 0)
            {
                stepId = state.Steps.Count > 0 ? state.Steps.Max(s => s.Id) + 1 : 1;
            }
            step = new PlanStep { Id = stepId, Title = stepTitle, Status = stepStatus, Result = stepResult };
            state.Steps.Add(step);
        }
        else
        {
            step.Title = stepTitle;
            step.Status = stepStatus;
            step.Result = stepResult;
        }

        state.UpdatedAt = Now();

        // Write state file
        try
        {
            await WriteStateFileAsync(plan.FilePath!, state.PlanId, state.Title, state.Status, state.Steps, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return EncodeError($"Failed to write plan state file: {ex.Message}");
        }

        // Notify frontend
        var updatedPlan = LoadPlanById(parameters, plan.Id);
        if (updatedPlan != null)
        {
            await NotifyPlanUiAsync("step-update", updatedPlan, null, parameters, context, cancellationToken);
        }

        return EncodeJsonObject(writer =>
        {
            writer.WriteString("status", "step_updated");
            writer.WriteNumber("step_id", stepId);
            writer.WriteString("step_title", stepTitle);
            writer.WriteString("step_status", stepStatus);
            writer.WriteString("message", $"Step {stepId} ({stepTitle}) marked as {stepStatus}.");
        });
    }

    // ── Reverse Request Notification ──

    private static async Task NotifyPlanUiAsync(
        string action,
        PlanEntity plan,
        string? content,
        JsonElement parameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        try
        {
            var request = CreateJsonElement(writer =>
            {
                writer.WriteString("action", action);
                writer.WriteString("sessionId", plan.SessionId);
                writer.WritePropertyName("plan");
                WritePlanSnapshot(writer, plan, content);
                WriteNullableString(writer, "activeSessionId", JsonHelpers.GetString(parameters, "sessionId"));
            });

            await AgentRuntimeReverseRequests.RequestAsync(
                context,
                "plan/ui-update",
                request,
                cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            WorkerLog.Warn($"plan ui update failed action={action} planId={plan.Id} error={ex.GetType().Name}: {ex.Message}");
        }
    }

    private sealed record PlanRunState(bool Active, string? FilePath);
}
