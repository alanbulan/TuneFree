
import { Song, TopList, SystemHealth } from '../types';

const API_BASE = 'https://music-dl.sayqz.com/api';

// Helper to handle API response structure
const fetchApi = async (params: Record<string, string>) => {
  const searchParams = new URLSearchParams(params);
  const url = `${API_BASE}/?${searchParams.toString()}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      referrerPolicy: 'no-referrer',
      credentials: 'omit'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (e) {
    console.error(`Fetch error for ${url}:`, e);
    throw e;
  }
};

// 1. Get Song Info
export const getSongInfo = async (id: string | number, source: string): Promise<Partial<Song> | null> => {
  try {
    const data = await fetchApi({ source, id: String(id), type: 'info' });
    if (data.code === 200 && data.data) {
      return {
        pic: data.data.pic,
        url: data.data.url, 
        lrc: data.data.lrc
      };
    }
    return null;
  } catch (e) {
    return null;
  }
};

// 2. Get Song URL (Optimized & Robust)
export const getSongUrl = async (id: string | number, source: string, br: string = '320k'): Promise<string | null> => {
    const url = `${API_BASE}/?source=${source}&id=${id}&type=url&br=${br}`;
    
    try {
        // Use AbortController to timeout the check quickly (1.5s)
        // We only want to peek at headers or verify it's not a JSON error.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1500);

        const res = await fetch(url, { 
            method: 'GET', 
            referrerPolicy: 'no-referrer',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            const contentType = res.headers.get('content-type');
            
            // If explicit JSON/HTML, it's an error/landing page
            if (contentType && (contentType.includes('application/json') || contentType.includes('text/html'))) {
                // Read body to confirm error (if small)
                try {
                    const text = await res.text();
                    // If it parses as JSON error, return null
                    if (text.startsWith('{') || text.startsWith('[')) {
                         const json = JSON.parse(text);
                         if (json.code || json.msg || json.success === false) {
                             return null;
                         }
                    }
                    // If HTML, definitely not audio
                    if (contentType.includes('text/html')) return null;
                } catch {
                    return null;
                }
            }
            // If content-type is audio/mpeg, octet-stream, or missing (often redirects), assume valid.
            return url;
        }
        
        // HTTP 4xx/5xx
        if (res.status >= 400) return null;

        return url;
    } catch (e: any) {
        // Timeout (AbortError) or CORS Error (TypeError)
        // In both cases, we assume the URL might be valid (audio CDN) and let the Audio Element try it.
        return url;
    }
};

// 2b. Get Download URL with specific Quality
export const getDownloadUrl = (id: string | number, source: string, br: string): string => {
    return `${API_BASE}/?source=${source}&id=${id}&type=url&br=${br}`;
};

// 3. Get Pic (Constructed URL helper)
export const getPicUrl = (id: string | number, source: string) => {
    return `${API_BASE}/?source=${source}&id=${id}&type=pic`;
};

// 4. Get Lyrics
export const getLyrics = async (id: string | number, source: string): Promise<string> => {
  try {
    const response = await fetch(`${API_BASE}/?source=${source}&id=${id}&type=lrc`, {
        referrerPolicy: 'no-referrer'
    });
    return await response.text();
  } catch (e) {
    return "";
  }
};

// 5. Search (Basic) - Added page param
export const searchSongs = async (keyword: string, source: string, page: number = 1): Promise<Song[]> => {
  try {
    const data = await fetchApi({ source, type: 'search', keyword, page: String(page) });
    if (data.code === 200 && data.data && data.data.results) {
      return data.data.results.map((item: any) => ({
        id: item.id,
        name: item.name,
        artist: Array.isArray(item.artist) ? item.artist.join('/') : (item.artist || "Unknown"),
        album: item.album || "",
        source: item.platform || source,
        pic: item.pic_id ? getPicUrl(item.pic_id, source) : undefined,
        types: item.types || []
      }));
    }
    return [];
  } catch (e) {
    return [];
  }
};

// 6. Aggregate Search (All Platforms) - Added page param
export const searchAggregate = async (keyword: string, page: number = 1): Promise<Song[]> => {
  try {
      const data = await fetchApi({ type: 'aggregateSearch', keyword, page: String(page) });
      if (data.code === 200 && data.data && data.data.results) {
          return data.data.results.map((item: any) => ({
            id: item.id,
            name: item.name,
            artist: Array.isArray(item.artist) ? item.artist.join('/') : (item.artist || "Unknown"),
            album: item.album || "",
            source: item.platform,
            // If pic is not provided, we might need to fetch info later or construct if pic_id exists
            pic: item.pic || (item.pic_id ? getPicUrl(item.pic_id, item.platform) : undefined),
            types: item.types || []
          }));
      }
      return [];
  } catch (e) {
      console.warn("Aggregate search failed", e);
      return [];
  }
};

// 7. Get Playlist Detail (Import)
export const getOnlinePlaylist = async (id: string, source: string): Promise<{name: string, songs: Song[]} | null> => {
    try {
        const data = await fetchApi({ source, id, type: 'playlist' });
        if (data.code === 200 && data.data && data.data.list) {
            const songs = data.data.list.map((item: any) => ({
                id: item.id,
                name: item.name,
                artist: item.artist_name || (Array.isArray(item.artist) ? item.artist.join(',') : item.artist) || "Unknown",
                album: item.album_title || item.album || "",
                source: source,
                pic: item.pic || item.picUrl,
                types: item.types || []
            }));
            return {
                name: data.data.info?.name || "Imported Playlist",
                songs
            };
        }
        return null;
    } catch (e) {
        console.error("Playlist fetch failed", e);
        return null;
    }
};

// 8. Get Toplists
export const getTopLists = async (source: string): Promise<TopList[]> => {
  try {
    const data = await fetchApi({ source, type: 'toplists' });
    if (data.code === 200 && data.data && data.data.list) {
      return data.data.list.map((item: any) => ({
        id: item.id,
        name: item.name,
        updateFrequency: item.updateFrequency
      }));
    }
    return [];
  } catch (e) {
    console.warn(`Toplist fetch failed for ${source}`, e);
    return [];
  }
};

// 9. Get Toplist Detail
export const getTopListDetail = async (id: string | number, source: string): Promise<Song[]> => {
  try {
    const data = await fetchApi({ source, id: String(id), type: 'toplist' });
    if (data.code === 200 && data.data && data.data.list) {
        return data.data.list.map((item: any) => ({
            id: item.id,
            name: item.name,
            artist: item.artist_name || (Array.isArray(item.artist) ? item.artist.join(',') : item.artist) || "Unknown",
            album: item.album_title || item.album || "",
            source: source,
            pic: item.pic || item.picUrl,
            types: item.types || []
        }));
    }
    return [];
  } catch (e) {
    return [];
  }
};

// 10. System Status (Retained but optional if backend supports it)
export const getSystemStatus = async () => {
    try {
        const response = await fetch(`${API_BASE.replace('/api', '')}/status`, { referrerPolicy: 'no-referrer' });
        return await response.json();
    } catch(e) {
        return null;
    }
};

// 11. System Health (Retained but optional if backend supports it)
export const getSystemHealth = async (): Promise<SystemHealth | null> => {
    try {
        const response = await fetch(`${API_BASE.replace('/api', '')}/health`, { referrerPolicy: 'no-referrer' });
        const data = await response.json();
        return data.data;
    } catch (e) {
        return null;
    }
};

// Latency Checker
export const checkLatency = async (): Promise<number> => {
    const start = performance.now();
    try {
        await fetch(`${API_BASE}/?type=toplists&source=netease`, { method: 'HEAD', referrerPolicy: 'no-referrer' });
        const end = performance.now();
        return Math.round(end - start);
    } catch (e) {
        return -1;
    }
};

// --- Helpers ---
export const triggerDownload = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

export const downloadMusic = (song: Song) => {
    // Deprecated in favor of UI with selection, but kept for compatibility
    if (!song.url) return;
    triggerDownload(song.url, `${song.artist} - ${song.name}.mp3`);
};
