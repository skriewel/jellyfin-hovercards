using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.HoverCards.Api;

/// <summary>
/// Serves the client assets. Anonymous on purpose: the script tag loads before login,
/// and the assets contain nothing but UI code and display settings.
/// </summary>
[ApiController]
[Route("HoverCards")]
[AllowAnonymous]
public class HoverCardsController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    [HttpGet("ClientScript")]
    [Produces("application/javascript")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult GetClientScript()
    {
        var plugin = Plugin.Instance;
        if (plugin is null)
        {
            return NotFound();
        }

        var cfg = plugin.Configuration;
        var clientConfig = new
        {
            cfg.Enabled,
            cfg.HomeScreenOnly,
            HoverDelayMs = Math.Clamp(cfg.HoverDelayMs, 0, 5000),
            ScaleFactor = Math.Clamp(cfg.ScaleFactor, 1.0, 3.0),
            MinWidthPx = Math.Clamp(cfg.MinWidthPx, 200, 1200),
            cfg.IncludePosterCards,
            cfg.PosterInlineExpand,
            cfg.IncludeEpisodes,
            cfg.ShowOverview,
            cfg.ShowGenres,
            cfg.ShowLogo,
            cfg.ShowTrailerButton,
            cfg.ShowFavoriteButton,
            cfg.ShowPlayedButton,
            cfg.SeriesPlayNextUp,
            ExcludeSelectors = cfg.ExcludeSelectors ?? string.Empty,
            Version = plugin.CacheKey
        };

        var script = "window.HoverCardsConfig = " + JsonSerializer.Serialize(clientConfig, JsonOptions) + ";\n"
            + ReadResource("Web.hovercards.js");

        Response.Headers.CacheControl = "public, max-age=86400";
        return Content(script, "application/javascript; charset=utf-8");
    }

    [HttpGet("ClientStyle")]
    [Produces("text/css")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult GetClientStyle()
    {
        Response.Headers.CacheControl = "public, max-age=86400";
        return Content(ReadResource("Web.hovercards.css"), "text/css; charset=utf-8");
    }

    private static string ReadResource(string relativeName)
    {
        var asm = Assembly.GetExecutingAssembly();
        var name = $"{typeof(Plugin).Namespace}.{relativeName}";
        using var stream = asm.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Missing embedded resource {name}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
