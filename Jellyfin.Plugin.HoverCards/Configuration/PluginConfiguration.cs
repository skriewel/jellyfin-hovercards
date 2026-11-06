using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.HoverCards.Configuration;

public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>Master switch for the client-side effect.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Only on the home screen (incl. Home Screen Sections / KefinTweaks home) or on every page with cards.</summary>
    public bool HomeScreenOnly { get; set; } = true;

    /// <summary>Delay before a card expands, in milliseconds.</summary>
    public int HoverDelayMs { get; set; } = 450;

    /// <summary>Width of the expanded card relative to the original card.</summary>
    public double ScaleFactor { get; set; } = 1.5;

    /// <summary>Lower bound for the expanded width in pixels (keeps small poster cards readable).</summary>
    public int MinWidthPx { get; set; } = 380;

    /// <summary>Also expand portrait (poster) cards; they switch to a landscape backdrop.</summary>
    public bool IncludePosterCards { get; set; } = true;

    /// <summary>
    /// Poster rows: the poster widens in place inside its row (pushing the following posters aside)
    /// instead of opening a floating preview. Details are shown on top of the backdrop.
    /// </summary>
    public bool PosterInlineExpand { get; set; }

    /// <summary>Include episode cards (Continue Watching / Next Up).</summary>
    public bool IncludeEpisodes { get; set; } = true;

    public bool ShowOverview { get; set; } = true;

    public bool ShowGenres { get; set; } = true;

    public bool ShowLogo { get; set; } = true;

    public bool ShowTrailerButton { get; set; } = true;

    public bool ShowFavoriteButton { get; set; } = true;

    public bool ShowPlayedButton { get; set; } = true;

    /// <summary>For series, the play button starts the next-up episode (and shows e.g. "S2:E5").</summary>
    public bool SeriesPlayNextUp { get; set; } = true;

    /// <summary>Comma separated CSS selectors; cards inside matching containers are ignored.</summary>
    public string ExcludeSelectors { get; set; } = string.Empty;

    /// <summary>Bumped on every save; used as script cache key.</summary>
    public long Revision { get; set; }
}
