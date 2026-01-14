import { Song, TopList, SystemHealth, StatsSummary, PlatformStats, QpsStats, RequestTypeStats } from '../types';

const API_BASE = 'https://api.tunefree.fun/api';
const STATS_BASE = 'https://api.tunefree.fun/stats';

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

const fetchStats = async (endpoint: string, params: Record<string, string> = {}) => {
  const searchParams = new URLSearchParams(params);
  const url = `${STATS_BASE}${endpoint}?${searchParams.toString()}`;
  try {
      const response = await fetch(url, { referrerPolicy: 'no-referrer' });
      return await response.json();
  } catch (e) {
      console.warn(`Stats fetch failed: ${url}`, e);
      return null;
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

// 2. Get Song URL
export const getSongUrl = async (id: string | number, source: string): Promise<string | null> => {
    // We construct the URL directly for the audio element to handle redirects
    return `${API_BASE}/?source=${source}&id=${id}&type=url&br=320k`;
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

// 5. Search (Basic) - kept for fallback or specific source search
export const searchSongs = async (keyword: string, source: string): Promise<Song[]> => {
  try {
    const data = await fetchApi({ source, type: 'search', keyword });
    if (data.code === 200 && data.data && data.data.results) {
      return data.data.results.map((item: any) => ({
        id: item.id,
        name: item.name,
        artist: Array.isArray(item.artist) ? item.artist.join('/') : (item.artist || "Unknown"),
        album: item.album || "",
        source: item.platform || source,
        pic: item.pic_id ? getPicUrl(item.pic_id, source) : undefined
      }));
    }
    return [];
  } catch (e) {
    return [];
  }
};

// 6. Aggregate Search (All Platforms)
export const searchAggregate = async (keyword: string): Promise<Song[]> => {
  try {
      const data = await fetchApi({ type: 'aggregateSearch', keyword });
      if (data.code === 200 && data.data && data.data.results) {
          return data.data.results.map((item: any) => ({
            id: item.id,
            name: item.name,
            artist: Array.isArray(item.artist) ? item.artist.join('/') : (item.artist || "Unknown"),
            album: item.album || "",
            source: item.platform,
            // If pic is not provided, we might need to fetch info later or construct if pic_id exists
            pic: item.pic || (item.pic_id ? getPicUrl(item.pic_id, item.platform) : undefined)
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
                pic: item.pic || item.picUrl
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
            pic: item.pic || item.picUrl
        }));
    }
    return [];
  } catch (e) {
    return [];
  }
};

// 10. System Status
export const getSystemStatus = async () => {
    try {
        const response = await fetch(`https://api.tunefree.fun/status`, { referrerPolicy: 'no-referrer' });
        return await response.json();
    } catch(e) {
        return null;
    }
};

// 11. System Health
export const getSystemHealth = async (): Promise<SystemHealth | null> => {
    try {
        const response = await fetch(`https://api.tunefree.fun/health`, { referrerPolicy: 'no-referrer' });
        const data = await response.json();
        return data.data;
    } catch (e) {
        return null;
    }
};

// 12-17. Statistics APIs
export const getStatsSummary = async (): Promise<StatsSummary | null> => {
    const res = await fetchStats('/summary');
    return res?.data || null;
};

export const getPlatformStats = async (period: string = 'today'): Promise<PlatformStats | null> => {
    const res = await fetchStats('/platforms', { period });
    return res?.data || null;
};

export const getQpsStats = async (period: string = 'today'): Promise<QpsStats | null> => {
    const res = await fetchStats('/qps', { period });
    return res?.data || null;
};

export const getRequestTypeStats = async (period: string = 'today'): Promise<RequestTypeStats | null> => {
    const res = await fetchStats('/types', { period });
    return res?.data || null;
};
