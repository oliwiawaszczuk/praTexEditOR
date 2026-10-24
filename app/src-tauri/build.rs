fn main() {
    // For tests that locate binaries/tectonic-<triple> (externalBin naming).
    println!("cargo:rustc-env=TARGET_TRIPLE={}", std::env::var("TARGET").unwrap());
    tauri_build::build()
}
