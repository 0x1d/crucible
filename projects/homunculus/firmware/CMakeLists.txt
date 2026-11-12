cmake_minimum_required(VERSION 3.16)

# Per-machine git-ignored settings (Wi-Fi credentials, server URL), if present.
# Defaults only fill keys missing from sdkconfig: run `idf.py reconfigure` after editing.
set(SDKCONFIG_DEFAULTS "sdkconfig.defaults")
if(EXISTS "${CMAKE_CURRENT_LIST_DIR}/sdkconfig.local")
    list(APPEND SDKCONFIG_DEFAULTS "sdkconfig.local")
endif()

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(homunculus)
