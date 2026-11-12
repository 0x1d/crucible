idf_component_register(
    SRCS "src/visualizer.cpp" "src/ring_renderer.cpp" "src/card_renderer.cpp"
    INCLUDE_DIRS "include"
    PRIV_INCLUDE_DIRS "src"
    REQUIRES homunculus_agent
    PRIV_REQUIRES esp_timer espressif__qrcode
)

# Per-frame rasterisation: -O2 regardless of the project's debug optimisation level.
set_source_files_properties(src/ring_renderer.cpp PROPERTIES COMPILE_OPTIONS "-O2")

# qrcodegen.h sits at the root of the qrcode component, outside its include directories.
idf_component_get_property(qrcode_dir espressif__qrcode COMPONENT_DIR)
target_include_directories(${COMPONENT_LIB} PRIVATE ${qrcode_dir})
