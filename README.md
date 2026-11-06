# Hover Cards – Jellyfin-Plugin (Jellyfin 12.x)

Hover-Vorschau im Stil großer Streamingdienste: Bleibt die Maus kurz auf einer Film- oder Serienkachel
des Startbildschirms, wächst die Kachel zu einer größeren, schwebenden Karte. Sie zeigt:

- großes Hintergrundbild (Backdrop) und Titel-Logo, bei Episoden das Episodenbild
- Titel, bei Episoden zusätzlich `S1:F2 · Episodentitel`
- **Abspielen / Fortsetzen** mit Fortschrittsbalken; bei Serien direkt die nächste Folge („S2 F5 abspielen“)
- Trailer, Favorit, Gesehen und das Jellyfin-Kontextmenü (`…`)
- Altersfreigabe, Community- und Kritikerbewertung, Jahr, Laufzeit bzw. Staffelanzahl, „Endet um“
- Genres und eine Kurzbeschreibung (3 Zeilen)

Ein Klick auf das Bild oder den Titel öffnet die Detailseite, ein Rechtsklick das Kontextmenü, `Esc` schließt.

## Installation

### Über das Plugin-Repository (mit Updates)

1. *Dashboard → Plugins → Repositorys → +* und diese URL eintragen:
   `https://raw.githubusercontent.com/skriewel/jellyfin-hovercards/main/manifest.json`
2. Im Katalog **Hover Cards** auswählen und installieren, danach Jellyfin neu starten.
3. Neue Versionen erscheinen dann als Update im Dashboard.

Voraussetzung: Das GitHub-Repo ist öffentlich, sonst kann Jellyfin Manifest und Paket nicht laden.

### Manuell

1. `build.ps1` ausführen (oder das fertige `dist\HoverCards_1.0.4.0.zip` nehmen).
2. Den Ordner `dist\HoverCards_1.0.4.0` (mit `Jellyfin.Plugin.HoverCards.dll` und `meta.json`) in das
   Plugin-Verzeichnis des Servers kopieren:
   - Docker: `/config/plugins/HoverCards_1.0.4.0/`
   - Linux (Paket): `/var/lib/jellyfin/plugins/HoverCards_1.0.4.0/`
   - Windows: `%ProgramData%\Jellyfin\Server\plugins\HoverCards_1.0.4.0\`
3. Jellyfin neu starten und im Browser einmal hart neu laden (Strg+F5).
4. Einstellungen: *Dashboard → Plugins → Hover Cards*.

Voraussetzung: Jellyfin **12.x** (gebaut und getestet gegen 12.4, .NET 10). Weitere Plugins sind nicht nötig.

## Einstellungen

| Option | Standard | Bedeutung |
|---|---|---|
| Nur Startbildschirm | an | Auch Zeilen von Home Screen Sections und KefinTweaks zählen dazu. Aus = alle Seiten mit Kacheln. |
| Hover-Verzögerung | 450 ms | Wie lange die Maus ruhen muss |
| Skalierung | 1.5 | Breite der Vorschau relativ zur Kachel |
| Mindestbreite | 380 px | Kleine Poster wachsen mindestens auf diese Breite |
| Poster-Kacheln | an | Hochkant-Poster wechseln in der Vorschau auf das Querformat-Backdrop |
| Poster-Reihen: in der Reihe verbreitern | aus | Statt der schwebenden Vorschau wird das Poster in seiner Reihe zur Querformat-Kachel (gleiche Höhe) und schiebt die folgenden Poster zur Seite; die Reihe scrollt bei Bedarf mit. Infos und Buttons liegen links auf dem Backdrop. Gilt nur für horizontale Poster-Reihen, alle anderen Kacheln behalten die schwebende Vorschau. |
| Episoden-Kacheln | an | „Weiterschauen“ / „Als Nächstes“ |
| Serie: nächste Folge | an | Play-Button startet die nächste Folge |
| Logo / Genres / Beschreibung / Trailer / Favorit / Gesehen | an | Einzelne Elemente ein- und ausblenden |
| Ausgeschlossene Container | leer | CSS-Selektoren, z. B. `[data-section-type="upcoming"]` |

Optik anpassen per Custom CSS (*Dashboard → Allgemein → Custom CSS*), zum Beispiel:

```css
:root { --hc-bg: #0f171e; --hc-accent: #1a98ff; --hc-radius: 12px; }
```

## Zusammenspiel mit Jellyfin Enhanced, KefinTweaks und Home Screen Sections

- **Die Original-Kachel wird nie verändert** (Ausnahme: der optionale Reihen-Modus für Poster setzt vorübergehend Breite und Bildhöhe der Kachel als Inline-Style und stellt die alten Werte danach exakt wieder her). Die Vorschau ist ein eigenes Element mit `position: fixed`
  direkt unter `<body>`. Die horizontalen Scroller schneiden sie deshalb nicht ab, und die CSS-Regeln,
  Overlays und Tags anderer Plugins auf den Kacheln bleiben unberührt (JE-Tags, KefinTweaks-Skins,
  Rahmen und Animationen).
- **Event-Delegation statt DOM-Patching:** Kacheln, die später entstehen, funktionieren automatisch. Dazu
  gehören Lazy Loading und Neuaufbau bei Home Screen Sections sowie die eigenen Sektionen von KefinTweaks.
  Erkannt werden Kacheln über die Standardattribute `.card[data-id][data-serverid]`.
- **Aktionen über Jellyfins eigenen Mechanismus:** Abspielen, Trailer, Details und Menü laufen über
  jellyfin-webs Item-Action-Handler. Dafür klickt das Plugin ein unsichtbares Element in der Kachel.
  Wiedergabe, Player und alle Hooks anderer Plugins verhalten sich deshalb exakt wie beim normalen Klick.
- **Skript-Einbindung wie bei Jellyfin Enhanced:** Eine ASP.NET-Middleware ergänzt `index.html` beim
  Ausliefern um ein `<link>`- und ein `<script>`-Tag. Dateien im Web-Ordner werden nicht geschrieben,
  File Transformation ist nicht nötig, und das Ganze verträgt sich mit JE, File Transformation (HSS)
  und JS Injector (KefinTweaks), weil jeder nur seine eigenen Tags anhängt.
- **Ausgenommen:** Seerr-, Empfehlungs- und Hidden-Content-Kacheln von Jellyfin Enhanced (eigenes
  Hover-UI), Dialoge, Multi-Select-Modus, TV-Layout und Touch-Geräte.
- Eine Vorschau erscheint erst, wenn das Element erfolgreich vom Server geladen wurde. Kacheln, die keine
  Bibliothekselemente sind, bleiben also unverändert.

## Projektstruktur

```
Jellyfin.Plugin.HoverCards/
  Plugin.cs                         Plugin-Klasse, Konfigurationsseite, Cache-Key
  PluginServiceRegistrator.cs       registriert die Injection-Middleware
  Injection/ScriptInjectionStartupFilter.cs   ergänzt index.html beim Ausliefern
  Api/HoverCardsController.cs       /HoverCards/ClientScript, /HoverCards/ClientStyle
  Configuration/                    Einstellungen + Dashboard-Seite
  Web/hovercards.js, hovercards.css Client-Code
build.ps1                           Build + Paket (dist/)
```

## Neue Version veröffentlichen

1. Version in der `.csproj` und als Standardwert in `build.ps1` erhöhen, Changelog in `build.ps1` anpassen.
2. `.\build.ps1` ausführen: baut das Paket nach `dist\` und trägt die Version mit Prüfsumme in `manifest.json` ein.
3. Commit und Push, dann das GitHub-Release anlegen (Tag `v<Version>`, das ZIP aus `dist\` anhängen):
   `gh release create v<Version> dist\<Paket>.zip --title "<Name> <Version>"`

Der Download-Link in `manifest.json` zeigt auf genau dieses Release-Asset, deshalb müssen Tag und Dateiname passen.
