idf_component_register(
    SRCS "src/visualizer.cpp" "src/ring_renderer.cpp" "src/card_renderer.cpp"
    INCLUDE_DIRS "include"
    PRIV_INCLUDE_DIRS "src"
    REQUIRES homunculus_agent
    PRIV_REQUIRES esp_timer
)

# Per-frame rasterisation: -O2 regardless of the project's debug optimisation level.
set_source_files_properties(src/ring_renderer.cpp PROPERTIES COMPILE_OPTIONS "-O2")
