# Nexor

Nexor e um app web premium para organizacao, rotina, projetos, tarefas, financeiro, habitos e equipe.

## Deploy Rapido

Este pacote e estatico. A Vercel consegue publicar diretamente a partir de `index.html`.

1. Suba estes arquivos para um repositorio GitHub.
2. Importe o repositorio na Vercel.
3. Defina o diretório raiz como a pasta que contem `index.html`.
4. Publique.

## Supabase

A pasta `supabase/migrations` contem a estrutura inicial de banco com RLS por usuario. Use em um projeto Supabase dedicado ao Nexor.

Importante: desde abril de 2026, novos projetos Supabase podem nao expor tabelas publicas automaticamente na Data API. A migration ja inclui `GRANT` para `authenticated` e RLS nas tabelas.

## Variaveis

Veja `.env.example`.

## GitHub

Arquivos principais para commitar:

- `index.html`
- `nexor-logo-transparent.png`
- `nexor-mark-transparent.png`
- `package.json`
- `vercel.json`
- `.env.example`
- `supabase/**`
