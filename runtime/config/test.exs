import Config

config :runtime,
  memory_path:
    Path.join(System.tmp_dir!(), "alchemist-memory-#{System.unique_integer([:positive])}.graph")
