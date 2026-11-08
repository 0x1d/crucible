idf_component_register(
    SRCS "src/hdp.cpp" "src/hdp_client.cpp" "src/agent.cpp" "src/wifi.cpp" "src/settings.cpp" "src/provision.cpp" "src/provision_form.cpp"
    INCLUDE_DIRS "include"
    PRIV_INCLUDE_DIRS "src"
    PRIV_REQUIRES esp_wifi esp_netif esp_event nvs_flash esp_timer esp_app_format mbedtls esp_http_server
)

# The agent registers itself with the Brookesia plugin registries from static
# initialisers; force-link those objects.
target_link_libraries(${COMPONENT_LIB} INTERFACE "-u homunculus_agent_symbol" "-u homunculus_agent_service_symbol")
