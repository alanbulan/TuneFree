fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // 复用 tauri-build 已编译的资源，测试宿主与主程序使用相同的 Common Controls v6 清单。
        let resource =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("resource.lib");
        assert!(resource.is_file(), "缺少 Tauri Windows 应用资源");
        println!("cargo:rustc-link-arg-tests={}", resource.display());
    }
}
