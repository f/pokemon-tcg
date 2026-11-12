use std::sync::OnceLock;
use std::time::Duration;
use tauri::ipc::Response;

const MAX_BYTES: usize = 20 * 1024 * 1024;

fn asset_name(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn set_image(path: &str, prefix: &str, extension: &str) -> bool {
    path.strip_prefix(prefix)
        .and_then(|path| path.split_once('/'))
        .is_some_and(|(set, file)| asset_name(set) &&
            file.strip_suffix(extension).is_some_and(asset_name))
}

fn tcgdex_card_path(path: &str) -> bool {
    let Some(path) = path.strip_prefix('/') else { return false };
    let mut segments = path.split('/');
    if !matches!(segments.next(), Some("zh-tw" | "zh-cn" | "ja" | "es")) {
        return false;
    }
    for _ in 0..3 {
        if !segments.next().is_some_and(asset_name) {
            return false;
        }
    }
    matches!(segments.next(), Some("high.png" | "high.webp")) && segments.next().is_none()
}

#[tauri::command]
pub async fn card_image_resource(url: String) -> Result<Response, String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "Invalid card image URL")?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err("Invalid card image URL".into());
    }
    let path = url.path();
    let article_path = path.strip_prefix("/tcg/").map(|part| {
        ["product/", "other/", "campaign/"].iter()
            .find_map(|prefix| part.strip_prefix(*prefix)).unwrap_or(part)
    });
    let article_id = article_path.and_then(|part| part.strip_suffix(".html"));
    let (article, referer) = match url.host_str() {
        Some("www.pokemon.cn") if url.query().is_none() &&
            article_id.is_some_and(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit())) => (true, None),
        Some("image.pokemon.com.cn") if path.starts_with("/wp-content/uploads/") => (false, Some("https://www.pokemon.cn/")),
        Some("media.52poke.com") if path.starts_with("/wiki/") => (false, Some("https://wiki.52poke.com/")),
        Some("campaign-30th.pokemon.cn") => (false, None),
        Some("asia.pokemon-card.com") if url.query().is_none() &&
            path.strip_prefix("/tw/card-img/tw").and_then(|name| name.strip_suffix(".png"))
                .is_some_and(|id| id.len() == 8 && id.bytes().all(|b| b.is_ascii_digit())) => (false, None),
        Some("asia.pokemon-card.com") if url.query().is_none() &&
            path.strip_prefix("/tw/archive/special/card/").or_else(|| path.strip_prefix("/hk/archive/special/card/"))
                .and_then(|rest| rest.split_once("/assets/images/"))
                .is_some_and(|(set, name)| asset_name(set) && name.strip_suffix(".png").is_some_and(asset_name)) => (false, None),
        Some("assets.tcgdex.net") if url.query().is_none() && tcgdex_card_path(path) => (false, None),
        Some("www.pokemon-card.com") if url.query().is_none() &&
            set_image(path, "/assets/images/card_images/large/", ".jpg") => (false, None),
        Some("limitlesstcg.nyc3.cdn.digitaloceanspaces.com") if url.query().is_none() &&
            (set_image(path, "/tpc/", "_JP.png") || set_image(path, "/tpci/", "_ES.png")) => (false, None),
        Some("cdn.malie.io") if url.query().is_none() &&
            set_image(path, "/file/malie-io/tcgl/cards/png/es/", ".png") => (false, None),
        Some("images.wikidexcdn.net") if url.query().is_none() &&
            path.starts_with("/mwuploads/wikidex/") && path.ends_with(".png") => (false, None),
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
    let valid_type = if article { mime == Some("text/html") } else { matches!(mime, Some("image/png" | "image/webp" | "image/jpeg")) };
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
