-- =====================================================
-- Supabase テーブル定義 & RLS
-- Supabase SQL Editor にこのファイルの内容を貼り付けて実行
-- =====================================================

-- 1. ワークスペース
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- 2. ワークスペースメンバー
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner', -- 'owner' / 'member' とか
  created_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- 3. プロジェクト
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

-- 4. ノード（フォルダ＆ファイル共通）
create table if not exists public.nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.nodes(id) on delete cascade,
  type text not null check (type in ('file', 'folder')),
  name text not null,
  created_at timestamptz default now()
);

-- 5. ファイル中身
create table if not exists public.file_contents (
  node_id uuid primary key references public.nodes(id) on delete cascade,
  text text not null default '',
  updated_at timestamptz default now()
);

-- updated_at を自動更新するトリガー
create or replace function public.touch_file_contents_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_file_contents_updated_at on public.file_contents;

create trigger set_file_contents_updated_at
before update on public.file_contents
for each row execute procedure public.touch_file_contents_updated_at();

-- =====================================================
-- RLS（行レベルセキュリティ）設定
-- =====================================================

-- RLS 有効化
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.nodes enable row level security;
alter table public.file_contents enable row level security;

-- workspaces: 自分が owner のものだけ見える
create policy "workspaces_select_owner"
  on public.workspaces
  for select
  using (owner_id = auth.uid());

create policy "workspaces_insert_owner"
  on public.workspaces
  for insert
  with check (owner_id = auth.uid());

-- workspace_members: 自分がメンバーのレコードだけ見える
create policy "workspace_members_select_self"
  on public.workspace_members
  for select
  using (user_id = auth.uid());

create policy "workspace_members_insert_self"
  on public.workspace_members
  for insert
  with check (user_id = auth.uid());

-- projects: 自分がメンバーのworkspaceに属するものだけ
create policy "projects_select_members"
  on public.projects
  for select
  using (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

create policy "projects_insert_members"
  on public.projects
  for insert
  with check (
    workspace_id in (
      select workspace_id from public.workspace_members
      where user_id = auth.uid()
    )
  );

-- nodes
create policy "nodes_select_members"
  on public.nodes
  for select
  using (
    project_id in (
      select id from public.projects
      where workspace_id in (
        select workspace_id from public.workspace_members
        where user_id = auth.uid()
      )
    )
  );

create policy "nodes_insert_members"
  on public.nodes
  for insert
  with check (
    project_id in (
      select id from public.projects
      where workspace_id in (
        select workspace_id from public.workspace_members
        where user_id = auth.uid()
      )
    )
  );

-- file_contents
create policy "file_contents_select_members"
  on public.file_contents
  for select
  using (
    node_id in (
      select id from public.nodes
      where project_id in (
        select id from public.projects
        where workspace_id in (
          select workspace_id from public.workspace_members
          where user_id = auth.uid()
        )
      )
    )
  );

create policy "file_contents_insert_members"
  on public.file_contents
  for insert
  with check (
    node_id in (
      select id from public.nodes
      where project_id in (
        select id from public.projects
        where workspace_id in (
          select workspace_id from public.workspace_members
          where user_id = auth.uid()
        )
      )
    )
  );

create policy "file_contents_update_members"
  on public.file_contents
  for update
  using (
    node_id in (
      select id from public.nodes
      where project_id in (
        select id from public.projects
        where workspace_id in (
          select workspace_id from public.workspace_members
          where user_id = auth.uid()
        )
      )
    )
  );

