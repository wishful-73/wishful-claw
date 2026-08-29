using System.Text.Json;
using System.Text.Json.Nodes;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Persona;

/// <summary>
/// Persona IPC module: exposes persona library CRUD and project copy endpoints.
/// Endpoints:
///   persona/list             — list all personas (builtin + custom)
///   persona/get              — get full persona config (4 markdown files)
///   persona/save             — save a persona (create or update)
///   persona/delete           — delete a custom persona (builtin cannot be deleted)
///   persona/apply-to-project — copy persona(s) to a project's persona library
/// </summary>
public sealed class PersonaModule : IWorkerModule
{
    public string Name => "persona";

    public void Register(IWorkerModuleContext context)
    {
        context.Register("persona/list", List);
        context.Register("persona/get", Get);
        context.Register("persona/save", Save);
        context.Register("persona/delete", Delete);
        context.Register("persona/apply-to-project", ApplyToProject);
        context.Register("persona/generate", GenerateAsync);
    }

    // ── List ──

    private static WorkerResponse List(JsonElement parameters)
    {
        var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");
        var store = PersonaStore.Default;
        var personas = store.ListPersonas(workingFolder);

        var array = new JsonArray();
        foreach (var p in personas)
        {
            array.Add((JsonNode)new JsonObject
            {
                ["id"] = p.Id,
                ["name"] = p.Name,
                ["tagline"] = p.Tagline,
                ["description"] = p.Description,
                ["isBuiltin"] = p.IsBuiltin
            });
        }

        return ToResponse(new JsonObject { ["personas"] = array });
    }

    // ── Get ──

    private static WorkerResponse Get(JsonElement parameters)
    {
        var id = JsonHelpers.GetString(parameters, "id");
        if (string.IsNullOrWhiteSpace(id))
        {
            return ToResponse(Mutation(false, "Missing persona id"));
        }

        var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");
        var config = PersonaStore.Default.GetPersona(id, workingFolder);
        if (config is null)
        {
            return ToResponse(Mutation(false, "Persona not found"));
        }

        return ToResponse(new JsonObject
        {
            ["id"] = config.Id,
            ["name"] = config.Name,
            ["tagline"] = config.Tagline,
            ["description"] = config.Description,
            ["isBuiltin"] = config.IsBuiltin,
            ["identityMarkdown"] = config.IdentityMarkdown,
            ["soulMarkdown"] = config.SoulMarkdown,
            ["ontologyMarkdown"] = config.OntologyMarkdown,
            ["agentsMarkdown"] = config.AgentsMarkdown
        });
    }

    // ── Save ──

    private static WorkerResponse Save(JsonElement parameters)
    {
        var id = JsonHelpers.GetString(parameters, "id");
        if (string.IsNullOrWhiteSpace(id))
        {
            // Generate an ID from the name if not provided
            var name = JsonHelpers.GetString(parameters, "name") ?? string.Empty;
            id = GeneratePersonaId(name);
        }

        var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");
        var isBuiltin = PersonaStore.BuiltinPresetIds.Contains(id) &&
                        string.IsNullOrWhiteSpace(workingFolder);

        var config = new PersonaConfig(
            id,
            JsonHelpers.GetString(parameters, "name") ?? id,
            JsonHelpers.GetString(parameters, "tagline") ?? string.Empty,
            JsonHelpers.GetString(parameters, "description") ?? string.Empty,
            isBuiltin,
            JsonHelpers.GetString(parameters, "identityMarkdown") ?? string.Empty,
            JsonHelpers.GetString(parameters, "soulMarkdown") ?? string.Empty,
            JsonHelpers.GetString(parameters, "ontologyMarkdown") ?? string.Empty,
            JsonHelpers.GetString(parameters, "agentsMarkdown") ?? string.Empty);

        PersonaStore.Default.SavePersona(config, workingFolder);

        return ToResponse(new JsonObject
        {
            ["success"] = true,
            ["id"] = id
        });
    }

    // ── Delete ──

    private static WorkerResponse Delete(JsonElement parameters)
    {
        var id = JsonHelpers.GetString(parameters, "id");
        if (string.IsNullOrWhiteSpace(id))
        {
            return ToResponse(Mutation(false, "Missing persona id"));
        }

        var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");

        if (PersonaStore.BuiltinPresetIds.Contains(id) &&
            string.IsNullOrWhiteSpace(workingFolder))
        {
            return ToResponse(Mutation(false, "Cannot delete built-in preset"));
        }

        var deleted = PersonaStore.Default.DeletePersona(id, workingFolder);
        return ToResponse(deleted
            ? new JsonObject { ["success"] = true }
            : Mutation(false, "Persona not found on disk"));
    }

    // ── Apply to project ──

    private static WorkerResponse ApplyToProject(JsonElement parameters)
    {
        var projectFolder = JsonHelpers.GetString(parameters, "projectFolder");
        if (string.IsNullOrWhiteSpace(projectFolder))
        {
            return ToResponse(Mutation(false, "Missing projectFolder"));
        }

        var personaId = JsonHelpers.GetString(parameters, "personaId");
        var count = PersonaStore.Default.CopyToProject(personaId, projectFolder);

        return ToResponse(new JsonObject
        {
            ["success"] = true,
            ["count"] = count
        });
    }

    // ── Generate (AI-assisted) ──

    private static async Task<WorkerResponse> GenerateAsync(JsonElement parameters, IWorkerRequestContext context)
    {
        var prompt = JsonHelpers.GetString(parameters, "prompt");
        if (string.IsNullOrWhiteSpace(prompt))
        {
            return ToResponse(Mutation(false, "Missing prompt"));
        }

        // Extract provider config from parameters
        if (!parameters.TryGetProperty("provider", out var providerEl) ||
            providerEl.ValueKind != JsonValueKind.Object)
        {
            return ToResponse(Mutation(false, "Missing provider configuration"));
        }

        var referencePersonaId = JsonHelpers.GetString(parameters, "referencePersonaId");
        var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");

        try
        {
            var draft = await PersonaGenerator.GenerateAsync(
                providerEl, prompt, referencePersonaId, workingFolder, context.CancellationToken);

            return ToResponse(draft);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"persona generation failed: {ex.Message}");
            return ToResponse(Mutation(false, $"Generation failed: {ex.Message}"));
        }
    }

    // ── Helpers ──

    private static string GeneratePersonaId(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return $"persona-{Guid.NewGuid():N}"[..24];

        // Use a simple slug from the name
        var slug = new string(name.Select(c => char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-').ToArray());
        slug = string.Join('-', slug.Split('-', StringSplitOptions.RemoveEmptyEntries));
        return string.IsNullOrWhiteSpace(slug) ? $"persona-{Guid.NewGuid():N}"[..24] : slug;
    }

    private static JsonObject Mutation(bool success, string? error)
    {
        var result = new JsonObject { ["success"] = success };
        if (!string.IsNullOrWhiteSpace(error))
        {
            result["error"] = error;
        }
        return result;
    }

    private static WorkerResponse ToResponse(JsonNode node)
    {
        return WorkerResponse.FromWriter(writer => node.WriteTo(writer));
    }
}
