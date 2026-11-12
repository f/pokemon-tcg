use std::sync::OnceLock;
use std::time::Duration;
use tauri::ipc::Response;

const MAX_BYTES: usize = 20 * 1024 * 1024;

#[tauri::command]
pub async fn card_image_resource(url: String) -> Result<Response, String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "Invalid card image URL")?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err("Invalid card image URL".into());
    }
    let path = url.path();
    let article_path = path.strip_prefix("/tcg/").map(|part| part.strip_prefix("product/").unwrap_or(part));
    let article_id = article_path.and_then(|part| part.strip_suffix(".html"));
    let (article, referer) = match url.host_str() {
        Some("www.pokemon.cn") if url.query().is_none() &&
            article_id.is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit())) => (true, None),
        Some("image.pokemon.com.cn") if path.starts_with("/wp-content/uploads/") => (false, Some("https://www.pokemon.cn/")),
        Some("media.52poke.com") if path.starts_with("/wiki/") => (false, Some("https://wiki.52poke.com/")),
        Some("campaign-30th.pokemon.cn") => (false, None),
        _ => return Err("Unknown printed card source".into()),
    };
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = CLIENT.get_or_init(|| reqwest::Client::builder()
        .user_agent("pokemon-tcg-app")
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(6))
        .build()
        .expect("card image HTTP client"));
    let mut request = client.get(url);
    if let Some(referer) = referer {
        request = request.header(reqwest::header::REFERER, referer);
    }
    let mut response = request.send().await.map_err(|_| "Printed card source unavailable")?;
    let mime = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next()).map(str::trim);
    let valid_type = if article { mime == Some("text/html") } else { matches!(mime, Some("image/png" | "image/webp")) };
    if !response.status().is_success() || !valid_type ||
        response.content_length().is_some_and(|length| length > MAX_BYTES as u64) {
        return Err("Invalid printed card source response".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Incomplete card image download")? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("Printed card resource exceeds the download limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Response::new(bytes))
}
