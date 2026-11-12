idf_component_register(
    SRCS "main.cpp"
    INCLUDE_DIRS "."
)

littlefs_create_partition_image(littlefs_data ../littlefs FLASH_IN_PROJECT)
