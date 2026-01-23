-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Existing tables (reconstructed based on usage)
create table if not exists public.workspaces (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  owner_id uuid references auth.users(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.workspace_members (
  id uuid default uuid_generate_v4() primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text not null check (role in ('owner', 'admin', 'member', 'read_only')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(workspace_id, user_id)
);

create table if not exists public.projects (
  id uuid default uuid_generate_v4() primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.nodes (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade not null,
  parent_id uuid references public.nodes(id) on delete cascade,
  type text not null check (type in ('file', 'folder')),
  name text not null,
  is_public boolean default false,
  public_access_role text check (public_access_role in ('viewer', 'editor')) default 'editor',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(project_id, parent_id, name)
);

-- Add column if table already exists
alter table public.nodes add column if not exists public_access_role text check (public_access_role in ('viewer', 'editor')) default 'editor';

create table if not exists public.file_contents (
  id uuid default uuid_generate_v4() primary key,
  node_id uuid references public.nodes(id) on delete cascade not null unique,
  text text,
  version integer default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
alter table public.file_contents add column if not exists version integer default 0 not null;

create table if not exists public.gc_jobs (
  id uuid default uuid_generate_v4() primary key,
  node_id uuid references public.nodes(id) on delete cascade not null unique,
  project_id uuid references public.projects(id) on delete cascade not null,
  status text not null check (status in ('queued', 'running', 'done', 'error')) default 'queued',
  attempts integer default 0 not null,
  run_after timestamp with time zone default timezone('utc'::text, now()) not null,
  last_error text,
  last_error_phase text,
  last_summary jsonb,
  duration_ms integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.gc_jobs add column if not exists last_error_phase text;
alter table public.gc_jobs add column if not exists last_summary jsonb;
alter table public.gc_jobs add column if not exists duration_ms integer;

-- Performance indexes
create index if not exists nodes_project_id_id_idx on public.nodes (project_id, id);
create index if not exists nodes_parent_id_idx on public.nodes (parent_id);
create index if not exists gc_jobs_status_run_after_idx on public.gc_jobs (status, run_after);

-- New tables for Chat History
create table if not exists public.chat_sessions (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  project_id uuid references public.projects(id) on delete cascade not null,
  title text not null default 'New Chat',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.chat_messages (
  id uuid default uuid_generate_v4() primary key,
  session_id uuid references public.chat_sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  images text[] default null,
  thought_trace jsonb default null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Optional: add new column when the table already exists
alter table public.chat_messages add column if not exists thought_trace jsonb;

-- RLS Policies
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.nodes enable row level security;
alter table public.file_contents enable row level security;
alter table public.gc_jobs enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- Workspace policies
create policy "Workspace members can view workspaces"
  on public.workspaces for select
  using (exists (
    select 1 from public.workspace_members
    where workspace_members.workspace_id = workspaces.id
    and workspace_members.user_id = auth.uid()
  ));

create policy "Users can create workspaces"
  on public.workspaces for insert
  with check (auth.uid() = owner_id);

create policy "Owners can update workspaces"
  on public.workspaces for update
  using (auth.uid() = owner_id);

create policy "Owners can delete workspaces"
  on public.workspaces for delete
  using (auth.uid() = owner_id);

-- Workspace members policies
create policy "Workspace members can view members"
  on public.workspace_members for select
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspace_members.workspace_id
    and wm.user_id = auth.uid()
  ));

create policy "Owners and admins can manage members"
  on public.workspace_members for insert
  with check (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspace_members.workspace_id
    and wm.user_id = auth.uid()
    and wm.role in ('owner', 'admin')
  ) or auth.uid() = user_id);

create policy "Owners and admins can delete members"
  on public.workspace_members for delete
  using (exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = workspace_members.workspace_id
    and wm.user_id = auth.uid()
    and wm.role in ('owner', 'admin')
  ) or auth.uid() = user_id);

-- Projects policies
create policy "Workspace members can view projects"
  on public.projects for select
  using (exists (
    select 1 from public.workspace_members
    where workspace_members.workspace_id = projects.workspace_id
    and workspace_members.user_id = auth.uid()
  ));

create policy "Workspace members can manage projects"
  on public.projects for all
  using (exists (
    select 1 from public.workspace_members
    where workspace_members.workspace_id = projects.workspace_id
    and workspace_members.user_id = auth.uid()
  ));

-- Nodes policies
create policy "Project members can view nodes"
  on public.nodes for select
  using (exists (
    select 1 from public.projects
    join public.workspace_members on workspace_members.workspace_id = projects.workspace_id
    where projects.id = nodes.project_id
    and workspace_members.user_id = auth.uid()
  ) or is_public = true);

create policy "Project members can manage nodes"
  on public.nodes for all
  using (exists (
    select 1 from public.projects
    join public.workspace_members on workspace_members.workspace_id = projects.workspace_id
    where projects.id = nodes.project_id
    and workspace_members.user_id = auth.uid()
  ));

-- File contents policies
create policy "Project members can view file contents"
  on public.file_contents for select
  using (exists (
    select 1 from public.nodes
    join public.projects on projects.id = nodes.project_id
    join public.workspace_members on workspace_members.workspace_id = projects.workspace_id
    where nodes.id = file_contents.node_id
    and workspace_members.user_id = auth.uid()
  ));

create policy "Project members can manage file contents"
  on public.file_contents for all
  using (exists (
    select 1 from public.nodes
    join public.projects on projects.id = nodes.project_id
    join public.workspace_members on workspace_members.workspace_id = projects.workspace_id
    where nodes.id = file_contents.node_id
    and workspace_members.user_id = auth.uid()
  ));

-- GC job policies
create policy "Project members can enqueue gc jobs"
  on public.gc_jobs for insert
  with check (exists (
    select 1 from public.projects
    join public.workspace_members on workspace_members.workspace_id = projects.workspace_id
    where projects.id = gc_jobs.project_id
    and workspace_members.user_id = auth.uid()
  ));

create policy "Project members can update gc jobs"
  on public.gc_jobs for update
  using (exists (
    select 1 from public.projects
    join public.workspace_members on workspace_members.workspace_id = projects.workspace_id
    where projects.id = gc_jobs.project_id
    and workspace_members.user_id = auth.uid()
  ));

-- Simple RLS for development (allow authenticated users to do everything for now)
-- In production, these should be stricter
create policy "Users can view their own chat sessions"
  on public.chat_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own chat sessions"
  on public.chat_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own chat sessions"
  on public.chat_sessions for update
  using (auth.uid() = user_id);

create policy "Users can delete their own chat sessions"
  on public.chat_sessions for delete
  using (auth.uid() = user_id);

create policy "Users can view messages of their sessions"
  on public.chat_messages for select
  using (exists (
    select 1 from public.chat_sessions
    where chat_sessions.id = chat_messages.session_id
    and chat_sessions.user_id = auth.uid()
  ));

create policy "Users can insert messages to their sessions"
  on public.chat_messages for insert
  with check (exists (
    select 1 from public.chat_sessions
    where chat_sessions.id = chat_messages.session_id
    and chat_sessions.user_id = auth.uid()
  ));

-- Storage bucket for chat images
-- Run this in Supabase Dashboard > Storage or SQL Editor:
-- 1. Create bucket named 'chat-images'
-- 2. Set it to public
-- 3. Add the following policies:

-- Storage policies (run in SQL Editor):
-- insert into storage.buckets (id, name, public) values ('chat-images', 'chat-images', true);

-- Allow authenticated users to upload
-- create policy "Authenticated users can upload images"
--   on storage.objects for insert
--   with check (bucket_id = 'chat-images' and auth.role() = 'authenticated');

-- Allow public to view images
-- create policy "Public can view images"
--   on storage.objects for select
--   using (bucket_id = 'chat-images');

-- Node shares table (for sharing files/folders with specific users)
create table if not exists public.node_shares (
  id uuid default uuid_generate_v4() primary key,
  node_id uuid references public.nodes(id) on delete cascade not null,
  shared_with_email text not null,
  shared_with_user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer', 'editor')) default 'viewer',
  created_by uuid references auth.users(id) on delete cascade not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(node_id, shared_with_email)
);

-- Index for faster lookups
create index if not exists node_shares_node_id_idx on public.node_shares (node_id);
create index if not exists node_shares_shared_with_email_idx on public.node_shares (shared_with_email);
create index if not exists node_shares_shared_with_user_id_idx on public.node_shares (shared_with_user_id);

-- RLS for node_shares
alter table public.node_shares enable row level security;

-- Users can view shares for nodes they own or have access to
create policy "Users can view node shares"
  on public.node_shares for select
  using (
    created_by = auth.uid()
    or shared_with_user_id = auth.uid()
    or shared_with_email = (select email from auth.users where id = auth.uid())
  );

-- Only the share creator can insert/update/delete shares
create policy "Users can create node shares"
  on public.node_shares for insert
  with check (created_by = auth.uid());

create policy "Users can update their node shares"
  on public.node_shares for update
  using (created_by = auth.uid());

create policy "Users can delete their node shares"
  on public.node_shares for delete
  using (created_by = auth.uid());

-- User profiles table (to lookup users by email)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text unique,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists profiles_email_idx on public.profiles (email);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Function to automatically create profile on user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to create profile on signup
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
