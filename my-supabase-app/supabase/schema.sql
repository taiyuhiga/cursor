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
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(project_id, parent_id, name)
);

create table if not exists public.file_contents (
  id uuid default uuid_generate_v4() primary key,
  node_id uuid references public.nodes(id) on delete cascade not null unique,
  text text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Performance indexes
create index if not exists nodes_project_id_id_idx on public.nodes (project_id, id);
create index if not exists nodes_parent_id_idx on public.nodes (parent_id);

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
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

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
