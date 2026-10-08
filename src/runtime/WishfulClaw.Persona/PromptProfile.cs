namespace WishfulClaw.Persona;

/// <summary>
/// Defines which system prompt profile to use.
/// Mirrors KodaClaw's PromptProfile.
/// </summary>
public enum PromptProfile
{
    /// <summary>
    /// Normal conversation — includes persona, environment, tools, project context.
    /// </summary>
    Main,

    /// <summary>
    /// Minimal prompt, no persona injection — no environment, tools or project context.
    /// Used by the goal-regression sandbox-prompt checks
    /// (<c>tests/WishfulClaw.GoalRegressionTests/Program.SandboxPrompt.cs</c>).
    /// The renderer-side persona generator (S-171) no longer goes through this profile.
    /// </summary>
    Bootstrap
}
