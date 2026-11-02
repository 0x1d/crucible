defmodule Runtime.MixProject do
  use Mix.Project

  def project do
    [
      app: :runtime,
      version: "0.1.0",
      elixir: "~> 1.20",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ] ++ test_config()
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {Runtime.Application, []}
    ]
  end

  defp deps do
    [
      {:jason, "~> 1.4"}
    ]
  end

  # Two separate suites:
  #
  #   mix test                                  -> runtime tests (test/)
  #   ALCHEMIST_TEST_SCOPE=functions mix test   -> codex entry tests
  #                                                (../functions/**/test/*_test.exs)
  #
  # Entry tests live next to their entry; they are `.exs`, so the codex compiler
  # (which only loads `*.ex`) and discovery (which needs `meta.json`) ignore them.
  defp test_config do
    case System.get_env("ALCHEMIST_TEST_SCOPE") do
      "functions" ->
        isolate_functions_suite_env!()

        [
          test_paths: ["../functions"],
          # entry sources (*.ex) and helpers share the tree with the tests
          test_ignore_filters: [&String.ends_with?(&1, ".ex"), &String.ends_with?(&1, "_helper.exs")]
        ]

      _ ->
        [test_paths: ["test"]]
    end
  end

  # The application (socket server + codex warm load) starts before any
  # test_helper runs, so the entry suite's environment must be set here:
  # - AGENT_FUNCTIONS_DIR: warm-load the real codex entries
  # - ALCHEMIST_STATE_DIR: keep the test server's port/pid files away from a
  #   live runtime's state dir
  defp isolate_functions_suite_env! do
    if System.get_env("AGENT_FUNCTIONS_DIR") in [nil, ""] do
      System.put_env("AGENT_FUNCTIONS_DIR", Path.expand("../functions", __DIR__))
    end

    if System.get_env("ALCHEMIST_STATE_DIR") in [nil, ""] do
      dir = Path.join(System.tmp_dir!(), "alchemist-functions-test-#{System.os_time()}")
      File.mkdir_p!(dir)
      System.put_env("ALCHEMIST_STATE_DIR", dir)
    end
  end
end
