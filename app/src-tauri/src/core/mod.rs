pub mod hostenv;
pub mod jsonio;
pub mod paths;
pub mod settings;
pub mod userdata;

/// Commands return `Result<T, String>`: Tauri serializes the error as the rejected
/// promise value, which the frontend shows as-is (Polish, user-facing).
pub type CmdResult<T> = Result<T, String>;

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
