idf_component_register(
    SRCS "src/hdp.cpp" "src/hdp_client.cpp" "src/agent.cpp" "src/wifi.cpp" "src/settings.cpp" "src/ota.cpp" "src/pairing.cpp"
    INCLUDE_DIRS "include"
    PRIV_INCLUDE_DIRS "src"
    PRIV_REQUIRES esp_wifi esp_netif esp_event nvs_flash esp_timer esp_app_format mbedtls esp_https_ota esp_http_client app_update esp-tls
)

# The agent registers itself with the Brookesia plugin registries from static
# initialisers; force-link those objects.
target_link_libraries(${COMPONENT_LIB} INTERFACE "-u homunculus_agent_symbol" "-u homunculus_agent_service_symbol")
