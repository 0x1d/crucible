idf_component_register(
    SRCS "src/visualizer.cpp" "src/ring_renderer.cpp"
    INCLUDE_DIRS "include"
    PRIV_INCLUDE_DIRS "src"
    REQUIRES homunculus_agent
    PRIV_REQUIRES esp_timer
)
