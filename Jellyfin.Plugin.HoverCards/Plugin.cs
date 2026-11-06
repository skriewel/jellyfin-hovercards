using Jellyfin.Plugin.HoverCards.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.HoverCards;

/// <summary>
/// Hover Cards: an expanding, detail-rich hover preview for media cards in jellyfin-web.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Hover Cards";

    public override Guid Id => Guid.Parse("7c3e2a51-9b6d-4f1e-8a2c-5d4b1e0f6a93");

    public override string Description =>
        "Expanding hover previews for movie and series cards on the home screen, with backdrop, details and quick actions.";

    /// <summary>
    /// Changes whenever the configuration is saved, so browsers refetch the client script.
    /// </summary>
    public string CacheKey => $"{Version}-{AssetHash.Value}-{Configuration.Revision}";

    private static readonly Lazy<string> AssetHash = new(() =>
    {
        var asm = typeof(Plugin).Assembly;
        using var sha = System.Security.Cryptography.SHA256.Create();
        foreach (var name in new[] { "Web.hovercards.js", "Web.hovercards.css" })
        {
            using var s = asm.GetManifestResourceStream($"{typeof(Plugin).Namespace}.{name}");
            if (s is null)
            {
                continue;
            }

            using var ms = new MemoryStream();
            s.CopyTo(ms);
            var bytes = ms.ToArray();
            sha.TransformBlock(bytes, 0, bytes.Length, null, 0);
        }

        sha.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
        return Convert.ToHexString(sha.Hash!)[..10].ToLowerInvariant();
    });

    public IEnumerable<PluginPageInfo> GetPages()
    {
        return new[]
        {
            new PluginPageInfo
            {
                Name = Name,
                EmbeddedResourcePath = $"{GetType().Namespace}.Configuration.configPage.html"
            }
        };
    }

    public override void UpdateConfiguration(BasePluginConfiguration configuration)
    {
        if (configuration is PluginConfiguration cfg)
        {
            cfg.Revision = DateTime.UtcNow.Ticks;
        }

        base.UpdateConfiguration(configuration);
    }
}
