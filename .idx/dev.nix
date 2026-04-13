# ============================================================
#  AJKMart - Google Project IDX Configuration
#  This enables one-click open in IDX
# ============================================================
{ pkgs, ... }: {
  channel = "stable-24.05";

  packages = [
    pkgs.nodejs_20
    pkgs.nodePackages.pnpm
    pkgs.postgresql_16
  ];

  env = {};

  idx = {
    extensions = [
      "dbaeumer.vscode-eslint"
      "esbenp.prettier-vscode"
      "bradlc.vscode-tailwindcss"
      "Prisma.prisma"
      "ms-azuretools.vscode-docker"
    ];

    workspace = {
      onCreate = {
        install = "pnpm install";
        setup-env = "cp .env.example .env && echo 'Edit .env with your DATABASE_URL then run: pnpm --filter @workspace/db run migrate'";
      };

      onStart = {
        api-server = "pnpm --filter @workspace/api-server run dev";
        admin = "pnpm --filter @workspace/admin run dev";
      };
    };

    previews = {
      enable = true;
      previews = {
        web = {
          command = ["pnpm" "--filter" "@workspace/admin" "run" "dev" "--port" "$PORT" "--host"];
          manager = "web";
        };
      };
    };
  };
}
