use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{any, get},
    Json, Router,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

#[derive(Deserialize)]
pub struct UrlQuery {
    pub platform: String,
    pub id: String,
    pub quality: Option<String>,
}

#[derive(Serialize)]
pub struct UrlResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

async fn handle_url(
    State(client): State<Client>,
    Query(query): Query<UrlQuery>,
) -> impl IntoResponse {
    let quality = query.quality.clone().unwrap_or_else(|| "128k".to_string());

    let result = match query.platform.as_str() {
        "netease" => crate::api::netease::get_netease_url(&client, &query.id, &quality).await,
        "qq" | "tencent" => crate::api::qq::get_tencent_url(&client, &query.id, &quality).await,
        "kuwo" => crate::api::kuwo::get_kuwo_url(&client, &query.id, &quality).await,
        _ => Err(format!("Platform {} not supported natively", query.platform).into()),
    };

    match result {
        Ok(url) => (
            StatusCode::OK,
            Json(UrlResponse {
                url: Some(url),
                error: None,
            }),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(UrlResponse {
                url: None,
                error: Some(e.to_string()),
            }),
        ),
    }
}

pub async fn start_server() {
    let client = Client::builder()
        .build()
        .unwrap_or_else(|_| Client::new());

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/url", get(handle_url))
        .route("/api/cors-proxy", any(crate::api::proxy::handle_cors_proxy))
        .layer(cors)
        .with_state(client);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3002));
    
    // We bind to 127.0.0.1:3002
    if let Ok(listener) = tokio::net::TcpListener::bind(addr).await {
        let _ = axum::serve(listener, app).await;
    }
}
