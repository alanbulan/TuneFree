use reqwest::Client;
use serde_json::Value;
use std::error::Error;

const USER_AGENTS: [&str; 4] = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 9_1 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13B143 Safari/601.1", 
    "Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Mobile Safari/537.36", 
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:46.0) Gecko/20100101 Firefox/46.0", 
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36"
];

fn get_random_user_agent() -> &'static str {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    USER_AGENTS[(nanos % USER_AGENTS.len() as u128) as usize]
}

pub async fn get_tencent_url(client: &Client, songmid: &str, quality: &str) -> Result<String, Box<dyn Error + Send + Sync>> {
    let filename_prefix = match quality {
        "128k" => "M5000.mp3",
        "320k" => "M8000.mp3",
        "flac" => "F0000.flac",
        _ => "M5000.mp3",
    };

    let data_param = format!(
        r#"{{"queryvkey":{{"method":"CgiGetVkey","module":"vkey.GetVkeyServer","param":{{"checklimit":0,"ctx":1,"downloadfrom":0,"uin":"0","filename":["{}"],"guid":"0","songmid":["{}"]}}}}}}"#,
        filename_prefix, songmid
    );

    let api_url = "https://u.y.qq.com/cgi-bin/musicu.fcg";

    let resp = client.get(api_url)
        .query(&[("data", &data_param)])
        .header("User-Agent", get_random_user_agent())
        .header("Origin", "https://y.qq.com")
        .header("Referer", "https://y.qq.com/portal/search.html")
        .send()
        .await?;

    let data: Value = resp.json().await?;
    if let Some(purl) = data["queryvkey"]["data"]["midurlinfo"][0]["purl"].as_str() {
        if !purl.is_empty() {
            return Ok(format!("http://ws.stream.qqmusic.qq.com/{}", purl));
        }
    }

    Err("Tencent returned empty purl (VIP/Copyright)".into())
}
