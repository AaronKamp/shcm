#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
mod gemini_proxy;
#[cfg(desktop)]
mod go2rtc;
#[cfg(desktop)]
mod ha_media;
#[cfg(desktop)]
mod ha_relay;
#[cfg(desktop)]
mod cloud_http;
#[cfg(desktop)]
mod cloud_photos;
#[cfg(desktop)]
mod photo_files;
#[cfg(desktop)]
mod photos;
#[cfg(desktop)]
mod relay_server;
#[cfg(desktop)]
mod secrets;
#[cfg(desktop)]
mod shortcuts;
#[cfg(desktop)]
mod unifi;
#[cfg(desktop)]
mod unifi_streams;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = desktop::configure(builder);

    builder
        .run(tauri::generate_context!())
        .expect("error while running Smart Home Command");
}
