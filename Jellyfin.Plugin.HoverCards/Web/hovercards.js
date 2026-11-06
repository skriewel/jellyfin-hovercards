/*
 * Hover Cards for Jellyfin 12
 * ---------------------------------------------------------------------------
 * Expanding hover preview for media cards (home screen by default):
 * after a short hover the card grows into a larger floating card with backdrop,
 * logo, play/trailer/favorite/played buttons, metadata and overview.
 *
 * Compatibility design (Jellyfin Enhanced, KefinTweaks, Home Screen Sections):
 *  - The original card is never modified, moved or transformed. The preview is a
 *    separate fixed-position element appended to <body>, so it is not clipped by
 *    horizontal scrollers and does not fight other plugins' card CSS or overlays.
 *  - Cards are found through event delegation on document (pointerover), so cards
 *    rendered later (HSS lazy loading, KefinTweaks sections, re-renders) just work.
 *  - Actions reuse jellyfin-web's own item-action handlers by dispatching a click on
 *    a short-lived invisible element inside the card. Playback therefore goes
 *    through the normal player flow (incl. JE/Kefin hooks); if no handler answers,
 *    it falls back to the item's details page.
 *  - Nothing global is overwritten; the only global is window.HoverCards.
 */
(function () {
    'use strict';

    if (window.HoverCards && window.HoverCards.loaded) {
        return;
    }

    var DEFAULTS = {
        enabled: true,
        homeScreenOnly: true,
        hoverDelayMs: 450,
        scaleFactor: 1.5,
        minWidthPx: 380,
        includePosterCards: true,
        posterInlineExpand: false,
        includeEpisodes: true,
        showOverview: true,
        showGenres: true,
        showLogo: true,
        showTrailerButton: true,
        showFavoriteButton: true,
        showPlayedButton: true,
        seriesPlayNextUp: true,
        excludeSelectors: ''
    };

    var cfg = Object.assign({}, DEFAULTS, window.HoverCardsConfig || {});
    if (!cfg.enabled) {
        return;
    }

    var SUPPORTED_TYPES = { Movie: 1, Series: 1, Season: 1, Episode: 1, BoxSet: 1, Video: 1, MusicVideo: 1, Trailer: 1 };
    // Containers whose cards already have their own hover UI or are not library items:
    // Jellyfin dialogs, Jellyfin Enhanced Seerr/recommendation/hidden-content tiles.
    var ALWAYS_EXCLUDED = '.dialogContainer, .dialog, .formDialog, .actionSheet, .itemSelectionPanel,'
        + ' .jellyseerr-card, .je-recommendations-tile, .je-hidden-item-card, .je-collection-card';
    var CACHE_TTL_MS = 5 * 60 * 1000;
    var GAP = 8; // min distance to viewport edges

    // ------------------------------------------------------------------ i18n
    var STRINGS = {
        en: {
            play: 'Play', resume: 'Resume', playEp: 'Play S{0} E{1}', resumeEp: 'Resume S{0} E{1}',
            trailer: 'Trailer', favAdd: 'Add to favorites', favRemove: 'Remove from favorites',
            playedAdd: 'Mark played', playedRemove: 'Mark unplayed', info: 'Details', more: 'More',
            season: '1 season', seasons: '{0} seasons', endsAt: 'Ends at {0}', left: '{0} left',
            h: 'h', min: 'min', episodes: '{0} episodes', items: '{0} items', epShort: 'E'
        },
        de: {
            play: 'Abspielen', resume: 'Fortsetzen', playEp: 'S{0} F{1} abspielen', resumeEp: 'S{0} F{1} fortsetzen',
            trailer: 'Trailer', favAdd: 'Zu Favoriten hinzufügen', favRemove: 'Aus Favoriten entfernen',
            playedAdd: 'Als gesehen markieren', playedRemove: 'Als ungesehen markieren', info: 'Details', more: 'Mehr',
            season: '1 Staffel', seasons: '{0} Staffeln', endsAt: 'Endet um {0}', left: 'noch {0}',
            h: 'Std.', min: 'Min.', episodes: '{0} Folgen', items: '{0} Titel', epShort: 'F'
        }
    };

    function lang() {
        var l = (document.documentElement.getAttribute('lang') || navigator.language || 'en').toLowerCase();
        return l.indexOf('de') === 0 ? 'de' : 'en';
    }

    function t(key) {
        var s = (STRINGS[lang()] || STRINGS.en)[key] || STRINGS.en[key] || key;
        for (var i = 1; i < arguments.length; i++) {
            s = s.replace('{' + (i - 1) + '}', arguments[i]);
        }
        return s;
    }

    // ------------------------------------------------------------------ helpers
    function api() {
        var c = window.ApiClient;
        return c && typeof c.getCurrentUserId === 'function' && c.getCurrentUserId() ? c : null;
    }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function icon(name) {
        var s = el('span', 'material-icons', name);
        s.setAttribute('aria-hidden', 'true');
        return s;
    }

    function canHover() {
        if (document.documentElement.classList.contains('layout-tv')) return false;
        if (document.documentElement.classList.contains('layout-mobile')) return false;
        return !window.matchMedia || window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    }

    function formatDuration(ticks) {
        if (!(ticks > 0)) return '';
        var totalMin = Math.max(1, Math.round(ticks / 600000000));
        var h = Math.floor(totalMin / 60);
        var m = totalMin % 60;
        if (h && m) return h + ' ' + t('h') + ' ' + m + ' ' + t('min');
        if (h) return h + ' ' + t('h');
        return m + ' ' + t('min');
    }

    function formatTime(date) {
        try {
            return date.toLocaleTimeString(document.documentElement.getAttribute('lang') || undefined, { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return date.toTimeString().slice(0, 5);
        }
    }

    function headerBottom() {
        var h = document.querySelector('.skinHeader');
        if (!h) return 0;
        var r = h.getBoundingClientRect();
        var style = getComputedStyle(h);
        if (style.display === 'none' || style.visibility === 'hidden' || r.bottom <= 0) return 0;
        return Math.max(0, r.bottom);
    }

    // ------------------------------------------------------------------ data
    var itemCache = new Map();

    function cached(key, loader) {
        var hit = itemCache.get(key);
        if (hit && Date.now() - hit.time < CACHE_TTL_MS) return hit.promise;
        var p = loader().catch(function (err) {
            itemCache.delete(key);
            throw err;
        });
        itemCache.set(key, { time: Date.now(), promise: p });
        return p;
    }

    function fetchItem(id) {
        var c = api();
        if (!c) return Promise.reject(new Error('not signed in'));
        return cached('item:' + id, function () {
            return c.getItem(c.getCurrentUserId(), id);
        });
    }

    function fetchNextUp(seriesId) {
        var c = api();
        if (!c) return Promise.resolve(null);
        return cached('nextup:' + seriesId, function () {
            var url = c.getUrl('Shows/NextUp', {
                SeriesId: seriesId,
                UserId: c.getCurrentUserId(),
                Limit: 1,
                EnableTotalRecordCount: false,
                EnableResumable: true,
                Fields: 'MediaSourceCount'
            });
            return c.getJSON(url).then(function (r) {
                return (r && r.Items && r.Items[0]) || null;
            });
        }).catch(function () { return null; });
    }

    function invalidate(id) {
        itemCache.delete('item:' + id);
        itemCache.forEach(function (v, k) {
            if (k.indexOf('nextup:') === 0) itemCache.delete(k);
        });
    }

    function imageUrl(itemId, type, tag, maxWidth, index) {
        var c = api();
        if (!c || !itemId || !tag) return null;
        var opts = { type: type, tag: tag, maxWidth: Math.round(maxWidth), quality: 90 };
        if (index != null) opts.index = index;
        return c.getImageUrl(itemId, opts);
    }

    // Picks the large landscape image and the logo for the preview.
    function pickArt(item, width) {
        var w = width * Math.min(window.devicePixelRatio || 1, 2);
        var tags = item.ImageTags || {};
        var art = { url: null, textless: true, logo: null };

        if (item.Type === 'Episode') {
            art.url = imageUrl(item.Id, 'Primary', tags.Primary, w)
                || imageUrl(item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag, w)
                || (item.ParentBackdropImageTags && imageUrl(item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], w, 0));
        } else if (item.Type === 'Season') {
            art.url = (item.ParentBackdropImageTags && imageUrl(item.ParentBackdropItemId, 'Backdrop', item.ParentBackdropImageTags[0], w, 0))
                || imageUrl(item.SeriesId, 'Thumb', item.SeriesThumbImageTag, w);
        } else {
            if (item.BackdropImageTags && item.BackdropImageTags.length) {
                art.url = imageUrl(item.Id, 'Backdrop', item.BackdropImageTags[0], w, 0);
            } else if (tags.Thumb) {
                art.url = imageUrl(item.Id, 'Thumb', tags.Thumb, w);
                art.textless = false; // thumbs usually carry the title already
            } else {
                art.url = imageUrl(item.Id, 'Primary', tags.Primary, w);
                art.textless = false;
            }
        }

        if (cfg.showLogo && art.textless) {
            if (tags.Logo) {
                art.logo = imageUrl(item.Id, 'Logo', tags.Logo, 500);
            } else if (item.ParentLogoItemId && item.ParentLogoImageTag) {
                art.logo = imageUrl(item.ParentLogoItemId, 'Logo', item.ParentLogoImageTag, 500);
            }
        }
        return art;
    }

    // ------------------------------------------------------------------ card discovery
    function findCard(target) {
        if (!target || !target.closest) return null;
        if (target.closest('.hc-pop')) return null;
        var card = target.closest('.card[data-id]');
        if (!card) return null;
        if (!card.getAttribute('data-serverid')) return null;
        var type = card.getAttribute('data-type');
        if (!SUPPORTED_TYPES[type]) return null;
        if (type === 'Episode' && !cfg.includeEpisodes) return null;
        if (card.closest(ALWAYS_EXCLUDED)) return null;
        if (cfg.excludeSelectors) {
            try {
                if (card.closest(cfg.excludeSelectors)) return null;
            } catch (e) { /* invalid selector from config: ignore */ }
        }
        if (cfg.homeScreenOnly && !card.closest('#indexPage, .homePage')) return null;
        if (card.closest('.hide, [hidden]')) return null;
        // Jellyfin's multi-select mode adds checkboxes to cards
        if (card.querySelector('.chkItemSelectContainer, .chkCardSelectContainer')) return null;

        var box = imageBox(card);
        if (!box) return null;
        var r = box.getBoundingClientRect();
        if (r.width < 60 || r.height < 40) return null;
        if (!cfg.includePosterCards && r.height > r.width * 1.05) return null;
        return card;
    }

    function imageBox(card) {
        return card.querySelector('.cardScalable') || card.querySelector('.cardImageContainer') || card.querySelector('.cardBox');
    }

    function cardImage(card) {
        var img = card.querySelector('.cardImageContainer');
        if (img) {
            var bg = getComputedStyle(img).backgroundImage;
            if (bg && bg !== 'none' && bg.indexOf('url(') !== -1) return bg;
            var dataSrc = img.getAttribute('data-src');
            if (dataSrc) return 'url("' + dataSrc + '")';
        }
        var tag = card.querySelector('.cardScalable img, .cardImageContainer img, img.cardImage');
        if (tag && (tag.currentSrc || tag.src)) return 'url("' + (tag.currentSrc || tag.src) + '")';
        return null;
    }

    // ------------------------------------------------------------------ actions
    function liveCard(state) {
        if (state.card && state.card.isConnected) return state.card;
        return document.querySelector('.card[data-id="' + CSS.escape(state.id) + '"]');
    }

    /**
     * Runs a jellyfin-web item action (play, resume, playtrailer, link, menu) by clicking an
     * invisible element inside the card, so jellyfin-web's own delegated handler performs it.
     * Returns true if a handler took it.
     */
    function runNativeAction(card, action, item, anchor) {
        if (!card) return false;
        var proxy = el('div', 'itemAction hc-proxy');
        proxy.setAttribute('data-action', action);
        proxy.setAttribute('data-id', item.Id);
        proxy.setAttribute('data-serverid', item.ServerId || card.getAttribute('data-serverid'));
        proxy.setAttribute('data-type', item.Type);
        proxy.setAttribute('data-isfolder', String(!!item.IsFolder));
        if (item.MediaType) proxy.setAttribute('data-mediatype', item.MediaType);
        if (item.SeriesId) proxy.setAttribute('data-seriesid', item.SeriesId);
        if (item.ChannelId) proxy.setAttribute('data-channelid', item.ChannelId);
        if (item.CollectionType) proxy.setAttribute('data-collectiontype', item.CollectionType);
        var pos = action === 'resume' && item.UserData ? item.UserData.PlaybackPositionTicks || 0 : 0;
        proxy.setAttribute('data-positionticks', String(pos));
        ['data-context', 'data-parentid'].forEach(function (a) {
            if (card.hasAttribute(a)) proxy.setAttribute(a, card.getAttribute(a));
        });

        var host = card.querySelector('.cardBox') || card;
        host.appendChild(proxy);
        if (anchor) placeAt(proxy, anchor.x, anchor.y);
        var handled = false;
        try {
            var ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
            handled = !proxy.dispatchEvent(ev);
        } finally {
            // jellyfin-web positions menus against this element only after loading the menu
            // asynchronously, so an anchored proxy must stay in place for a while.
            setTimeout(function () { proxy.remove(); }, anchor ? 10000 : 0);
        }
        return handled;
    }

    // Puts the proxy at viewport coordinates, compensating for transformed ancestors
    // (skins that scale or translate cards make position:fixed relative to them).
    function placeAt(proxy, x, y) {
        proxy.classList.add('hc-anchor');
        proxy.style.setProperty('left', x + 'px', 'important');
        proxy.style.setProperty('top', y + 'px', 'important');
        var r = proxy.getBoundingClientRect();
        var dx = x - r.left;
        var dy = y - r.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            proxy.style.setProperty('left', (x + dx) + 'px', 'important');
            proxy.style.setProperty('top', (y + dy) + 'px', 'important');
        }
    }

    function goToDetails(item) {
        var serverId = item.ServerId || (api() && api().serverId && api().serverId()) || '';
        var target = '#/details?id=' + encodeURIComponent(item.Id) + (serverId ? '&serverId=' + encodeURIComponent(serverId) : '');
        if (window.Emby && window.Emby.Page && typeof window.Emby.Page.show === 'function') {
            window.Emby.Page.show(target.slice(1));
        } else {
            window.location.hash = target.slice(1);
        }
    }

    function doAction(state, action, item, anchor) {
        var card = liveCard(state);
        close(true);
        if (!runNativeAction(card, action, item, anchor) && (action === 'link' || action === 'play' || action === 'resume')) {
            goToDetails(item);
        }
    }

    /**
     * jellyfin-web's card action "playtrailer" only plays local trailer files, so items that
     * only have remote (YouTube) trailers end in "no valid media source". The details page
     * uses playbackManager.playTrailers(), which handles both, but is not reachable from
     * outside. Jellyfin's own remote-control command "PlayTrailers", sent to this browser's
     * session, is routed by jellyfin-web to exactly that function.
     */
    function playTrailer(state, item) {
        var card = liveCard(state);
        close(true);
        if ((item.LocalTrailerCount || 0) > 0 && runNativeAction(card, 'playtrailer', item)) {
            return;
        }
        sendPlayTrailersCommand(item).catch(function (err) {
            console.warn('[HoverCards] PlayTrailers command failed, opening trailer URL instead', err);
            var remote = item.RemoteTrailers && item.RemoteTrailers[0];
            if (remote && remote.Url) {
                window.open(remote.Url, '_blank', 'noopener');
            } else {
                goToDetails(item);
            }
        });
    }

    function sendPlayTrailersCommand(item) {
        var c = api();
        if (!c || typeof c.deviceId !== 'function') return Promise.reject(new Error('no ApiClient'));
        var userId = c.getCurrentUserId();
        return c.getJSON(c.getUrl('Sessions', { deviceId: c.deviceId() })).then(function (sessions) {
            var own = (sessions || []).filter(function (s) { return s.UserId === userId; })[0] || (sessions || [])[0];
            if (!own) throw new Error('own session not found');
            return c.ajax({
                type: 'POST',
                url: c.getUrl('Sessions/' + own.Id + '/Command'),
                data: JSON.stringify({ Name: 'PlayTrailers', Arguments: { ItemId: item.Id } }),
                contentType: 'application/json'
            });
        });
    }

    function toggleUserData(state, kind, button) {
        var c = api();
        var item = state.item;
        if (!c || !item) return;
        var ud = item.UserData || (item.UserData = {});
        var isOn = kind === 'fav' ? !!ud.IsFavorite : !!ud.Played;
        var path = (kind === 'fav' ? 'UserFavoriteItems/' : 'UserPlayedItems/') + item.Id;
        button.disabled = true;
        c.ajax({ type: isOn ? 'DELETE' : 'POST', url: c.getUrl(path, { userId: c.getCurrentUserId() }), dataType: 'json' })
            .catch(function (err) {
                // some versions return 200 with an empty body which ajax(json) treats as error
                if (err && (err.status === 200 || err.status === 204)) return null;
                throw err;
            })
            .then(function () {
                if (kind === 'fav') ud.IsFavorite = !isOn; else ud.Played = !isOn;
                invalidate(item.Id);
                if (state === current) renderToggle(button, kind, !isOn);
            })
            .catch(function (err) {
                console.warn('[HoverCards] could not update user data', err);
            })
            .then(function () { button.disabled = false; });
    }

    function renderToggle(button, kind, on) {
        button.classList.toggle('hc-on', on);
        button.textContent = '';
        if (kind === 'fav') {
            button.appendChild(icon(on ? 'favorite' : 'favorite_border'));
            button.title = t(on ? 'favRemove' : 'favAdd');
        } else {
            button.appendChild(icon(on ? 'check_circle' : 'check'));
            button.title = t(on ? 'playedRemove' : 'playedAdd');
        }
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(on));
    }

    // ------------------------------------------------------------------ popup DOM
    function buildPop(state) {
        var pop = el('div', 'hc-pop');
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('data-id', state.id);

        var media = el('div', 'hc-media');
        var base = el('div', 'hc-img hc-img-base');
        if (state.baseImage) base.style.backgroundImage = state.baseImage;
        if (state.portrait) base.classList.add('hc-portrait');
        var hi = el('div', 'hc-img hc-img-hi');
        var logo = el('img', 'hc-logo');
        logo.alt = '';
        logo.decoding = 'async';
        media.appendChild(base);
        media.appendChild(hi);
        media.appendChild(logo);

        var panel = el('div', 'hc-panel');
        var title = el('div', 'hc-title', state.fallbackTitle || '');
        panel.appendChild(title);
        panel.appendChild(el('span', 'hc-skeleton'));
        var sk2 = el('span', 'hc-skeleton');
        sk2.style.width = '60%';
        panel.appendChild(sk2);

        pop.appendChild(media);
        pop.appendChild(panel);

        media.addEventListener('click', function (e) {
            e.preventDefault();
            if (state.item) doAction(state, 'link', state.item);
        });
        panel.addEventListener('click', function (e) {
            if (state.inline && state.item && (e.target === panel || e.target === state.els.logo)) doAction(state, 'link', state.item);
        });
        pop.addEventListener('contextmenu', function (e) {
            if (!state.item) return;
            e.preventDefault();
            doAction(state, 'menu', state.item, { x: e.clientX, y: e.clientY });
        });

        state.els = { pop: pop, media: media, base: base, hi: hi, logo: logo, panel: panel, title: title };
        return pop;
    }

    function fillPanel(state, item, nextUp) {
        var els = state.els;
        var panel = els.panel;
        panel.textContent = '';

        var isEpisode = item.Type === 'Episode';
        var titleText = isEpisode ? (item.SeriesName || item.Name) : (item.Type === 'Season' ? (item.SeriesName || item.Name) : item.Name);
        els.pop.setAttribute('aria-label', titleText || '');
        var titleEl = el('div', 'hc-title', titleText);
        titleEl.title = t('info');
        titleEl.addEventListener('click', function () { doAction(state, 'link', item); });
        panel.appendChild(titleEl);

        var sub = '';
        if (isEpisode) {
            var se = (item.ParentIndexNumber != null ? 'S' + item.ParentIndexNumber : '') + (item.IndexNumber != null ? ':' + t('epShort') + item.IndexNumber : '');
            sub = [se, item.Name].filter(Boolean).join(' · ');
        } else if (item.Type === 'Season') {
            sub = item.Name;
        }
        if (sub) panel.appendChild(el('div', 'hc-sub', sub));

        // ---- actions
        var actions = el('div', 'hc-actions');
        var playTarget = item;
        var ud = item.UserData || {};
        var label = t('play');
        var progress = 0;

        if (item.Type === 'Series' && nextUp) {
            playTarget = nextUp;
            var nud = nextUp.UserData || {};
            var resumeEp = nud.PlaybackPositionTicks > 0;
            label = t(resumeEp ? 'resumeEp' : 'playEp', nextUp.ParentIndexNumber != null ? nextUp.ParentIndexNumber : '?', nextUp.IndexNumber != null ? nextUp.IndexNumber : '?');
            progress = resumeEp ? nud.PlayedPercentage || 0 : 0;
        } else if (ud.PlaybackPositionTicks > 0) {
            label = t('resume');
            progress = ud.PlayedPercentage || 0;
        }

        var playable = item.IsFolder ? (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'BoxSet') : (item.MediaType === 'Video' || item.LocationType !== 'Virtual');
        if (playable) {
            var playBtn = el('button', 'hc-play');
            playBtn.type = 'button';
            playBtn.appendChild(icon('play_arrow'));
            playBtn.appendChild(el('span', 'hc-play-label', label));
            playBtn.title = label;
            if (progress > 0) {
                var bar = el('div', 'hc-play-progress');
                bar.style.width = Math.min(100, progress) + '%';
                playBtn.appendChild(bar);
            }
            playBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var resume = playTarget.UserData && playTarget.UserData.PlaybackPositionTicks > 0;
                doAction(state, resume ? 'resume' : 'play', playTarget);
            });
            actions.appendChild(playBtn);
        }

        var hasTrailer = (item.LocalTrailerCount || 0) > 0 || (item.RemoteTrailers && item.RemoteTrailers.length > 0);
        if (cfg.showTrailerButton && hasTrailer) {
            actions.appendChild(iconButton('movie', t('trailer'), function () { playTrailer(state, item); }));
        }
        if (cfg.showFavoriteButton) {
            var fav = iconButton('favorite_border', '', null, 'hc-fav');
            renderToggle(fav, 'fav', !!ud.IsFavorite);
            fav.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleUserData(state, 'fav', fav); });
            actions.appendChild(fav);
        }
        if (cfg.showPlayedButton && item.Type !== 'BoxSet') {
            var played = iconButton('check', '', null, 'hc-played');
            renderToggle(played, 'played', !!ud.Played);
            played.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleUserData(state, 'played', played); });
            actions.appendChild(played);
        }
        actions.appendChild(iconButton('more_horiz', t('more'), function (e) {
            // keyboard activation reports 0/0: fall back to the button itself
            var x = e.clientX, y = e.clientY;
            if (!x && !y) {
                var r = e.currentTarget.getBoundingClientRect();
                x = r.left + r.width / 2;
                y = r.top + r.height / 2;
            }
            doAction(state, 'menu', item, { x: x, y: y });
        }));
        panel.appendChild(actions);

        // ---- meta line
        var meta = el('div', 'hc-meta');
        if (item.OfficialRating) meta.appendChild(el('span', 'hc-badge', item.OfficialRating));
        if (item.CommunityRating) {
            var star = el('span');
            star.appendChild(el('span', 'hc-star', '★ '));
            star.appendChild(document.createTextNode(Number(item.CommunityRating).toFixed(1)));
            meta.appendChild(star);
        }
        if (item.CriticRating != null) meta.appendChild(el('span', null, (item.CriticRating >= 60 ? '🍅 ' : '🤢 ') + item.CriticRating + '%'));
        var year = item.ProductionYear;
        if (year) {
            var yearText = String(year);
            if (item.Type === 'Series' && item.EndDate && item.Status === 'Ended') {
                var endYear = new Date(item.EndDate).getFullYear();
                if (endYear && endYear !== year) yearText += '–' + endYear;
            } else if (item.Type === 'Series' && item.Status === 'Continuing') {
                yearText += '–';
            }
            meta.appendChild(el('span', null, yearText));
        }
        if (item.Type === 'Series' && item.ChildCount) {
            meta.appendChild(el('span', null, item.ChildCount === 1 ? t('season') : t('seasons', item.ChildCount)));
        } else if (item.Type === 'Season' && item.ChildCount) {
            meta.appendChild(el('span', null, t('episodes', item.ChildCount)));
        } else if (item.Type === 'BoxSet' && item.ChildCount) {
            meta.appendChild(el('span', null, t('items', item.ChildCount)));
        } else if (item.RunTimeTicks) {
            var remaining = item.RunTimeTicks - (ud.PlaybackPositionTicks || 0);
            if (ud.PlaybackPositionTicks > 0) {
                meta.appendChild(el('span', null, t('left', formatDuration(remaining))));
            } else {
                meta.appendChild(el('span', null, formatDuration(item.RunTimeTicks)));
            }
            if (item.Type === 'Movie') {
                meta.appendChild(el('span', null, t('endsAt', formatTime(new Date(Date.now() + remaining / 10000)))));
            }
        }
        if (meta.childNodes.length) panel.appendChild(meta);

        if (cfg.showGenres && item.Genres && item.Genres.length) {
            panel.appendChild(el('div', 'hc-genres', item.Genres.slice(0, 3).join(' · ')));
        }

        if (cfg.showOverview) {
            var overview = item.Overview || (item.Type === 'Season' && nextUp ? nextUp.Overview : '');
            if (overview) {
                var ov = el('div', 'hc-overview');
                // Overviews may contain simple HTML; render as text only.
                var tmp = document.createElement('div');
                tmp.innerHTML = overview;
                ov.textContent = tmp.textContent || '';
                panel.appendChild(ov);
            }
        }

        // ---- media progress bar for partially watched items
        var pct = item.Type === 'Series' ? 0 : ud.PlayedPercentage || 0;
        if (pct > 0 && pct < 100) {
            var mp = el('div', 'hc-media-progress');
            var fill = el('div');
            fill.style.width = pct + '%';
            mp.appendChild(fill);
            state.els.media.appendChild(mp);
        }

        // ---- art
        var art = pickArt(item, state.target.width);
        if (art.url) {
            var img = new Image();
            img.decoding = 'async';
            img.onload = function () {
                if (state !== current) return;
                els.hi.style.backgroundImage = 'url("' + art.url + '")';
                els.hi.classList.add('hc-loaded');
                reposition(state);
            };
            img.src = art.url;
        }
        if (art.logo && state.inline) {
            // on the in-row card the logo replaces the title above the buttons
            panel.insertBefore(els.logo, panel.firstChild);
            els.logo.onload = function () {
                els.logo.classList.add('hc-loaded');
                panel.classList.add('hc-has-logo');
                fitInline(state);
            };
            els.logo.onerror = function () { els.logo.remove(); };
            els.logo.src = art.logo;
        } else if (art.logo) {
            els.logo.onload = function () { els.logo.classList.add('hc-loaded'); };
            els.logo.onerror = function () { els.logo.remove(); };
            els.logo.src = art.logo;
        } else {
            els.logo.remove();
        }

        // after content changed the panel height, keep the card inside the viewport
        requestAnimationFrame(function () {
            reposition(state);
            fitInline(state);
        });
    }

    function iconButton(name, title, onClick, extraClass) {
        var b = el('button', 'hc-icon' + (extraClass ? ' ' + extraClass : ''));
        b.type = 'button';
        b.appendChild(icon(name));
        if (title) {
            b.title = title;
            b.setAttribute('aria-label', title);
        }
        if (onClick) {
            b.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                onClick(e);
            });
        }
        return b;
    }

    // ------------------------------------------------------------------ geometry
    function computeTarget(rect) {
        var vw = document.documentElement.clientWidth;
        var width = Math.max(rect.width * cfg.scaleFactor, cfg.minWidthPx);
        width = Math.min(width, vw - 2 * GAP);
        var mediaH = width * 9 / 16;
        var left = rect.left + rect.width / 2 - width / 2;
        left = Math.max(GAP, Math.min(left, vw - GAP - width));
        var top = rect.top + rect.height / 2 - mediaH / 2;
        return { left: left, top: top, width: width, mediaH: mediaH };
    }

    // Keeps the expanded card (incl. detail panel) inside the viewport, below the header.
    function reposition(state) {
        if (!state || !state.expanded || !state.els || state.inline) return;
        var pop = state.els.pop;
        var vh = window.innerHeight;
        var minTop = Math.max(GAP, headerBottom() + GAP);
        var totalH = state.target.mediaH + state.els.panel.scrollHeight + 26;
        var top = state.target.top;
        if (top + totalH > vh - GAP) top = vh - GAP - totalH;
        if (top < minTop) top = minTop;
        pop.style.top = top + 'px';
        state.top = top;
    }

    // ------------------------------------------------------------------ in-row poster expansion
    /*
     * Optional mode for poster rows: the hovered poster itself widens inside its row to a
     * landscape card (same height), pushing the following posters aside, and the row scrolls
     * along so the card stays fully visible. Only the card's own size is touched (inline styles,
     * restored afterwards); the visible content is still the fixed overlay, kept exactly on
     * top of the widening card every frame.
     */
    var EASE = 'cubic-bezier(0.2, 0.8, 0.25, 1)';

    function findRowScroller(card) {
        var slider = card.parentElement;
        if (!slider) return null;
        if (slider.classList.contains('vertical-wrap') || getComputedStyle(slider).flexWrap === 'wrap') return null;
        var sc = card.closest('.emby-scroller');
        if (sc) return sc;
        for (var e = slider; e && e !== document.body; e = e.parentElement) {
            var ox = getComputedStyle(e).overflowX;
            if (ox === 'auto' || ox === 'scroll') return e;
        }
        return null;
    }

    function planInline(card, box) {
        var height = box.offsetHeight;
        var imgW = box.offsetWidth;
        if (!(height > imgW * 1.05)) return null; // posters only
        var scroller = findRowScroller(card);
        if (!scroller) return null;
        var bounds = rowBounds(scroller);
        var visible = bounds.right - bounds.left;
        var extra = card.offsetWidth - imgW; // card margins/padding around the image
        var targetImgW = Math.min(height * 16 / 9, visible - 2 * GAP - extra);
        if (targetImgW < imgW * 1.2) return null;
        return { scroller: scroller, height: height, extra: extra, targetImgW: targetImgW };
    }

    // Visible horizontal range of a row. jellyfin-web's own scroller (emby-scroller) does not
    // clip (overflow visible, moved by transform), so its rows reach the viewport edges.
    function rowBounds(scroller) {
        var vw = document.documentElement.clientWidth;
        var ox = getComputedStyle(scroller).overflowX;
        if (ox !== 'auto' && ox !== 'scroll' && ox !== 'hidden' && ox !== 'clip') return { left: 0, right: vw };
        var sr = scroller.getBoundingClientRect();
        return { left: Math.max(sr.left, 0), right: Math.min(sr.right, vw) };
    }

    // Scrolls a row by the given pixels: through jellyfin-web's scroller API when present
    // (transform based), otherwise natively.
    function scrollRowBy(scroller, shift) {
        var api = scroller.scroller;
        if (api && typeof api.slideTo === 'function' && typeof api.getScrollPosition === 'function') {
            if (typeof api.reload === 'function') api.reload(); // the row just got wider
            api.slideTo(api.getScrollPosition() + shift, true);
        } else {
            scroller.scrollLeft += shift;
        }
    }

    // After the card shrinks back, a row scrolled to its very end would show a gap: slide back.
    function settleRow(scroller, removedPx) {
        var api = scroller.scroller;
        if (!api || typeof api.slideTo !== 'function' || !api._pos || typeof api._pos.end !== 'number') return;
        var end = Math.max(0, api._pos.end - removedPx);
        if (api.getScrollPosition() > end + 0.5) api.slideTo(end, false);
    }

    function saveStyle(rec, elem, prop) {
        rec.saved.push({ el: elem, prop: prop, value: elem.style.getPropertyValue(prop), priority: elem.style.getPropertyPriority(prop) });
    }

    function setImportant(elem, prop, value) {
        elem.style.setProperty(prop, value, 'important');
    }

    function restoreStyles(card) {
        var rec = card.__hcInline;
        if (!rec) return;
        clearTimeout(rec.timer);
        for (var i = rec.saved.length - 1; i >= 0; i--) {
            var s = rec.saved[i];
            if (s.value) s.el.style.setProperty(s.prop, s.value, s.priority);
            else s.el.style.removeProperty(s.prop);
        }
        delete card.__hcInline;
    }

    function inlineGrow(state) {
        var card = state.card;
        var box = imageBox(card);
        if (!card.isConnected || !box) return;
        var rec = card.__hcInline;
        if (rec) {
            clearTimeout(rec.timer); // re-hovered while shrinking back
        } else {
            rec = card.__hcInline = { saved: [], origWidth: card.offsetWidth, timer: 0 };
            var baseTransition = getComputedStyle(card).transition;
            ['width', 'min-width', 'max-width', 'flex', 'transition'].forEach(function (p) { saveStyle(rec, card, p); });
            saveStyle(rec, box, 'height');
            var padder = box.querySelector('.cardPadder');
            if (padder) saveStyle(rec, padder, 'padding-bottom');
            rec.transition = (baseTransition && baseTransition !== 'none' && !/^all 0s/.test(baseTransition) ? baseTransition + ', ' : '')
                + 'width 280ms ' + EASE;
            // freeze the current geometry: fixed image height, explicit width
            setImportant(box, 'height', state.inline.height + 'px');
            if (padder) setImportant(padder, 'padding-bottom', '0px');
            setImportant(card, 'min-width', '0px');
            setImportant(card, 'max-width', 'none');
            setImportant(card, 'flex', '0 0 auto');
            setImportant(card, 'width', rec.origWidth + 'px');
            void card.offsetWidth;
        }
        setImportant(card, 'transition', rec.transition);
        setImportant(card, 'width', (state.inline.targetImgW + state.inline.extra) + 'px');
    }

    function inlineShrink(state, animate) {
        var card = state.card;
        var rec = card && card.__hcInline;
        if (!rec) return;
        clearTimeout(rec.timer);
        if (!animate || !card.isConnected) {
            restoreStyles(card);
            return;
        }
        var removed = card.offsetWidth - rec.origWidth;
        setImportant(card, 'width', rec.origWidth + 'px');
        if (removed > 0 && state.inline) settleRow(state.inline.scroller, removed);
        rec.timer = setTimeout(function () {
            restoreStyles(card);
            var api = state.inline && state.inline.scroller.scroller;
            if (api && typeof api.reload === 'function') api.reload();
        }, 320);
    }

    // Keeps the overlay on top of the (moving, widening) card and the row scrolled so it fits.
    function startInlineSync(state) {
        var pop = state.els.pop;
        var scroller = state.inline.scroller;
        var header = headerBottom();
        function frame() {
            if (!pop.isConnected) return;
            var box = imageBox(state.card);
            if (!box || !box.isConnected) {
                pop.remove();
                if (current === state) current = null;
                return;
            }
            var r = box.getBoundingClientRect();
            var bounds = rowBounds(scroller);
            var right = bounds.right - (bounds.right < document.documentElement.clientWidth ? 0 : GAP);
            var left = bounds.left + (bounds.left > 0 ? 0 : GAP);
            if (current === state && state.expanded) {
                var shift = 0;
                if (r.right > right + 0.5) shift = r.right - right;
                else if (r.left < left - 0.5) shift = r.left - left;
                if (shift) {
                    state.selfScrollUntil = performance.now() + 400;
                    scrollRowBy(scroller, shift);
                    r = box.getBoundingClientRect();
                }
            }
            pop.style.left = r.left + 'px';
            pop.style.top = r.top + 'px';
            pop.style.width = r.width + 'px';
            state.els.media.style.height = r.height + 'px';
            // never draw over the header or outside the row's visible area
            var ct = Math.max(0, header - r.top);
            var cl = Math.max(0, bounds.left - r.left);
            var cr = Math.max(0, r.right - bounds.right);
            pop.style.clipPath = ct || cl || cr ? 'inset(' + ct + 'px ' + cr + 'px 0px ' + cl + 'px)' : '';
            requestAnimationFrame(frame);
        }
        frame();
    }

    // The in-row card is only as high as the poster: drop the least important lines until it fits.
    function fitInline(state) {
        if (!state.inline || !state.grown || state !== current || !state.els) return;
        var panel = state.els.panel;
        function overflowing() { return panel.scrollHeight > panel.clientHeight + 1; }
        if (!overflowing()) return;
        var ov = panel.querySelector('.hc-overview');
        if (ov) {
            ov.style.webkitLineClamp = '2';
            ov.style.lineClamp = '2';
            if (!overflowing()) return;
        }
        ['.hc-overview', '.hc-genres', '.hc-sub', '.hc-meta'].some(function (sel) {
            var n = panel.querySelector(sel);
            if (n) n.remove();
            return !overflowing();
        });
    }

    // ------------------------------------------------------------------ lifecycle
    var current = null;   // the open (or opening) popup state
    var pending = null;   // hover-intent state before the delay elapses
    var lastPointer = { x: -1, y: -1 };

    function cancelPending() {
        if (pending) {
            clearTimeout(pending.timer);
            pending = null;
        }
    }

    function scheduleOpen(card) {
        cancelPending();
        var id = card.getAttribute('data-id');
        if (current && current.id === id && current.card === card) return;
        var state = { card: card, id: id, timer: 0 };
        pending = state;
        // Fetch while the user is still deciding (cached). The preview only opens once the
        // item is known, so cards that are not library items never flash a preview.
        var itemReady = fetchItem(id).then(function (item) {
            if (item && item.Type === 'Series' && cfg.seriesPlayNextUp) fetchNextUp(item.Id);
            return item;
        });
        itemReady.catch(function () { /* not a library item: ignore */ });
        state.timer = setTimeout(function () {
            if (pending !== state) return;
            itemReady.then(function (item) {
                if (pending !== state) return;
                pending = null;
                if (!item || !card.isConnected || !pointerInside(card)) return;
                open(card, item);
            }, function () {
                if (pending === state) pending = null;
            });
        }, Math.max(0, cfg.hoverDelayMs));
    }

    function pointerInside(elem, pad) {
        if (!elem || !elem.isConnected) return false;
        var r = elem.getBoundingClientRect();
        pad = pad || 0;
        return lastPointer.x >= r.left - pad && lastPointer.x <= r.right + pad && lastPointer.y >= r.top - pad && lastPointer.y <= r.bottom + pad;
    }

    function open(card, item) {
        close(true);
        var box = imageBox(card);
        var rect = box.getBoundingClientRect();
        var titleEl = card.querySelector('.cardText-first, .cardText');
        var state = {
            card: card,
            id: card.getAttribute('data-id'),
            rect: rect,
            portrait: rect.height > rect.width * 1.05,
            baseImage: cardImage(card),
            fallbackTitle: titleEl ? titleEl.textContent.trim() : (card.getAttribute('aria-label') || ''),
            target: computeTarget(rect),
            expanded: false,
            item: null,
            inline: cfg.posterInlineExpand ? planInline(card, box) : null
        };
        if (state.inline) {
            state.target = { left: rect.left, top: rect.top, width: state.inline.targetImgW, mediaH: state.inline.height };
        }
        current = state;

        var pop = buildPop(state);
        var radius = getComputedStyle(card.querySelector('.cardContent, .cardImageContainer') || box).borderTopLeftRadius;
        // start exactly on top of the card ...
        pop.style.left = rect.left + 'px';
        pop.style.top = rect.top + 'px';
        pop.style.width = rect.width + 'px';
        if (radius && radius !== '0px') pop.style.borderRadius = radius;
        state.els.media.style.height = rect.height + 'px';
        pop.addEventListener('pointerleave', onPopLeave);
        if (state.inline) pop.classList.add('hc-inline');
        document.body.appendChild(pop);
        if (state.inline) startInlineSync(state);

        // ... then grow into the preview on the next frame
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (current !== state) return;
                if (state.inline) {
                    state.expanded = true;
                    pop.classList.add('hc-expanded');
                    inlineGrow(state);
                    setTimeout(function () {
                        if (current !== state) return;
                        state.grown = true;
                        fitInline(state);
                    }, 300);
                    return;
                }
                state.expanded = true;
                pop.classList.add('hc-expanded');
                pop.style.borderRadius = '';
                pop.style.left = state.target.left + 'px';
                pop.style.top = state.target.top + 'px';
                pop.style.width = state.target.width + 'px';
                state.els.media.style.height = state.target.mediaH + 'px';
                reposition(state);
            });
        });

        state.item = item;
        var nextUpPromise = item.Type === 'Series' && cfg.seriesPlayNextUp ? fetchNextUp(item.Id) : Promise.resolve(null);
        nextUpPromise.then(function (nextUp) {
            if (current !== state) return;
            fillPanel(state, item, nextUp);
        }).catch(function (err) {
            console.debug('[HoverCards]', err);
            if (current === state) fillPanel(state, item, null);
        });
    }

    function close(immediate) {
        cancelPending();
        var state = current;
        if (!state) return;
        current = null;
        var pop = state.els && state.els.pop;
        if (!pop) return;
        pop.removeEventListener('pointerleave', onPopLeave);
        if (state.inline) {
            inlineShrink(state, !immediate);
            if (immediate) {
                pop.remove();
                return;
            }
            // the poster shrinks back inside the row; the overlay follows it and turns back into the poster
            pop.classList.remove('hc-expanded');
            state.els.hi.classList.remove('hc-loaded');
            state.els.logo.classList.remove('hc-loaded');
            setTimeout(function () { pop.remove(); }, 300);
            return;
        }
        if (immediate) {
            pop.remove();
            return;
        }
        // shrink back towards the card, then fade out
        var card = state.card;
        if (card && card.isConnected) {
            var box = imageBox(card);
            var r = box && box.getBoundingClientRect();
            if (r && r.width) {
                pop.classList.remove('hc-expanded');
                pop.style.left = r.left + 'px';
                pop.style.top = r.top + 'px';
                pop.style.width = r.width + 'px';
                state.els.media.style.height = r.height + 'px';
            }
        }
        pop.classList.add('hc-leaving');
        setTimeout(function () { pop.remove(); }, 280);
    }

    function onPopLeave(e) {
        if (!current) return;
        lastPointer.x = e.clientX;
        lastPointer.y = e.clientY;
        // Moving back onto the original card area is still "inside".
        if (current.card && pointerInside(imageBox(current.card))) return;
        close(false);
    }

    // ------------------------------------------------------------------ global listeners
    document.addEventListener('pointerover', function (e) {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        if (e.buttons) return; // dragging / selecting
        if (!canHover()) return;
        if (current && current.els && current.els.pop.contains(e.target)) return;
        var card = findCard(e.target);
        if (!card) {
            cancelPending();
            return;
        }
        if (current && current.card === card) return;
        scheduleOpen(card);
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
        lastPointer.x = e.clientX;
        lastPointer.y = e.clientY;
        if (current && current.expanded && current.els) {
            var inPop = pointerInside(current.els.pop, 2);
            var inCard = current.card && pointerInside(imageBox(current.card));
            if (!inPop && !inCard) close(false);
        }
    }, { passive: true });

    document.addEventListener('pointerout', function (e) {
        if (!pending) return;
        var to = e.relatedTarget;
        if (!to || !pending.card.contains(to)) {
            if (!(to && to.closest && to.closest('.hc-pop'))) cancelPending();
        }
    }, { passive: true });

    // Scrolling (vertical page or horizontal rows) invalidates the position: close.
    // When scrolling stops, the pointer usually rests on a different card without any
    // pointer event firing, so re-check what is under the (unmoved) pointer then.
    var scrollIdleTimer = 0;
    function rearmAfterScroll() {
        clearTimeout(scrollIdleTimer);
        scrollIdleTimer = setTimeout(function () {
            if (current || lastPointer.x < 0 || !canHover()) return;
            var under = document.elementFromPoint(lastPointer.x, lastPointer.y);
            var card = findCard(under);
            if (card) scheduleOpen(card);
        }, 150);
    }

    document.addEventListener('scroll', function (e) {
        if (current && current.els && current.els.pop.contains(e.target)) return;
        // the row scrolling along with a poster that widens in place
        if (current && current.inline && e.target === current.inline.scroller && performance.now() < (current.selfScrollUntil || 0)) return;
        if (current || pending) close(true);
        rearmAfterScroll();
    }, { capture: true, passive: true });
    window.addEventListener('wheel', function (e) {
        // wheel events carry the pointer position even when the mouse itself did not move
        lastPointer.x = e.clientX;
        lastPointer.y = e.clientY;
        if (current && current.els && current.els.pop.contains(e.target) && Math.abs(e.deltaX) + Math.abs(e.deltaY) > 0) close(true);
        rearmAfterScroll();
    }, { passive: true });

    window.addEventListener('resize', function () { close(true); }, { passive: true });
    window.addEventListener('blur', function () { close(true); });
    window.addEventListener('hashchange', function () { close(true); });
    window.addEventListener('popstate', function () { close(true); });
    document.addEventListener('viewbeforehide', function () { close(true); }, true);
    document.addEventListener('visibilitychange', function () { if (document.hidden) close(true); });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && current) close(false);
    }, true);
    document.addEventListener('mousedown', function (e) {
        if (current && current.els && !current.els.pop.contains(e.target)) close(true);
    }, true);

    // Keep cached user data fresh when something else (player, other plugins, other devices) changes it.
    document.addEventListener('userdatachanged', function () { itemCache.clear(); });
    if (window.Events && typeof window.Events.on === 'function' && window.ApiClient) {
        try {
            window.Events.on(window.ApiClient, 'message', function (e, msg) {
                if (msg && msg.MessageType === 'UserDataChanged') itemCache.clear();
            });
        } catch (e) { /* optional */ }
    }

    window.HoverCards = {
        loaded: true,
        version: cfg.version || '',
        config: cfg,
        close: function () { close(true); },
        clearCache: function () { itemCache.clear(); }
    };
})();
