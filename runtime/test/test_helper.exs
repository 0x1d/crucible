functions_root = Path.expand("../../functions", __DIR__)
System.put_env("AGENT_FUNCTIONS_DIR", functions_root)

ExUnit.start()
