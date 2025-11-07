


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."add_sequence_step"("p_sequence_id" "uuid", "p_formation_id" "uuid", "p_label" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid;
  v_roster_ct int;
  v_cells_ct int;
  v_next_idx int;
  v_id uuid;
begin
  select owner_user_id into v_owner from public.sequences where id = p_sequence_id;
  if v_owner is null then raise exception 'sequence not found'; end if;
  if v_owner <> auth.uid() then raise exception 'not authorized (owner)'; end if;

  if not exists (
    select 1 from public.formations f
    where f.id = p_formation_id and f.owner_user_id = auth.uid()
  ) then
    raise exception 'formation not found or not owned by you';
  end if;

  select count(*) into v_roster_ct from public.sequence_roster where sequence_id = p_sequence_id;
  if v_roster_ct = 0 then raise exception 'roster is empty; save roster first'; end if;

  select count(*) into v_cells_ct from public.formation_cells where formation_id = p_formation_id;
  if v_cells_ct = 0 then raise exception 'formation has no cells'; end if;

  if v_roster_ct <> v_cells_ct then
    raise exception 'formation cell count (%) must equal roster size (%)', v_cells_ct, v_roster_ct;
  end if;

  select coalesce(max(step_index), 0) + 1 into v_next_idx
  from public.sequence_steps
  where sequence_id = p_sequence_id;

  insert into public.sequence_steps (sequence_id, step_index, formation_id, label)
  values (p_sequence_id, v_next_idx, p_formation_id, p_label)
  returning id into v_id;

  return v_id;
end
$$;


ALTER FUNCTION "public"."add_sequence_step"("p_sequence_id" "uuid", "p_formation_id" "uuid", "p_label" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_assign_step"("p_sequence_step_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_seq uuid;
  v_form uuid;
  v_owner uuid;
  v_roster_ct int;
  v_cells_ct int;
begin
  select st.sequence_id, st.formation_id, s.owner_user_id
    into v_seq, v_form, v_owner
  from public.sequence_steps st
  join public.sequences s on s.id = st.sequence_id
  where st.id = p_sequence_step_id;

  if v_seq is null then raise exception 'step not found'; end if;
  if v_owner <> auth.uid() then raise exception 'not authorized (owner)'; end if;

  select count(*) into v_roster_ct from public.sequence_roster where sequence_id = v_seq;
  select count(*) into v_cells_ct  from public.formation_cells where formation_id = v_form;

  if v_roster_ct <> v_cells_ct then
    raise exception 'cannot auto-assign: roster size (%) ≠ cell count (%)', v_roster_ct, v_cells_ct;
  end if;

  delete from public.step_assignments where sequence_step_id = p_sequence_step_id;

  with r as (
    select flyer_id, row_number() over (order by roster_index) as rn
    from public.sequence_roster
    where sequence_id = v_seq
  ),
  c as (
    select cell_index, row_number() over (order by col, row) as rn
    from public.formation_cells
    where formation_id = v_form
  )
  insert into public.step_assignments (sequence_step_id, flyer_id, formation_cell_index)
  select p_sequence_step_id, r.flyer_id, c.cell_index
  from r join c using (rn);
end
$$;


ALTER FUNCTION "public"."auto_assign_step"("p_sequence_step_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_adjacency_for_sequence"("p_sequence_id" "uuid", "p_wrap" boolean DEFAULT true) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid;
  rec record;
  prev_id uuid;
  first_id uuid;
  pair_ct int := 0;
begin
  select owner_user_id into v_owner from public.sequences where id = p_sequence_id;
  if v_owner is null then
    raise exception 'sequence not found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'not authorized (owner)';
  end if;

  prev_id := null;
  first_id := null;

  for rec in
    select id
    from public.sequence_steps
    where sequence_id = p_sequence_id
    order by step_index asc
  loop
    if prev_id is null then
      prev_id := rec.id;
      first_id := rec.id;
    else
      perform public.compute_and_cache_adjacency(prev_id, rec.id);
      pair_ct := pair_ct + 1;
      prev_id := rec.id;
    end if;
  end loop;

  if p_wrap and prev_id is not null and first_id is not null and prev_id <> first_id then
    perform public.compute_and_cache_adjacency(prev_id, first_id);
    pair_ct := pair_ct + 1;
  end if;

  return pair_ct;
end
$$;


ALTER FUNCTION "public"."compute_adjacency_for_sequence"("p_sequence_id" "uuid", "p_wrap" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_and_cache_adjacency"("p_step_a_id" "uuid", "p_step_b_id" "uuid") RETURNS TABLE("rotation_deg" integer, "tx" integer, "ty" integer, "max_overlap_count" integer, "n_size" integer, "threshold" integer, "different" boolean)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_seq_a uuid;
  v_seq_b uuid;
  v_owner uuid;
  v_n_a   int;
  v_n_b   int;
  v_n     int;
  v_rot   int;
  v_tx    int;
  v_ty    int;
  v_c     int;
  v_thr   int;
  v_diff  boolean;
  v_seq   uuid;
begin
  -- Ownership and same-sequence check
  select st.sequence_id, s.owner_user_id into v_seq_a, v_owner
  from public.sequence_steps st
  join public.sequences s on s.id = st.sequence_id
  where st.id = p_step_a_id;

  select st.sequence_id into v_seq_b
  from public.sequence_steps st
  where st.id = p_step_b_id;

  if v_seq_a is null or v_seq_b is null then
    raise exception 'step not found';
  end if;
  if v_seq_a <> v_seq_b then
    raise exception 'steps must belong to the same sequence';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'not authorized (owner)';
  end if;
  v_seq := v_seq_a;

  -- Compute points and best overlap
  with
  points_a as (
    select (fc.col + st.offset_tx) as x, (fc.row + st.offset_ty) as y
    from public.sequence_steps st
    join public.step_assignments sa on sa.sequence_step_id = st.id
    join public.formation_cells fc
      on fc.formation_id = st.formation_id
     and fc.cell_index   = sa.formation_cell_index
    where st.id = p_step_a_id
  ),
  points_b as (
    select (fc.col + st.offset_tx) as x, (fc.row + st.offset_ty) as y
    from public.sequence_steps st
    join public.step_assignments sa on sa.sequence_step_id = st.id
    join public.formation_cells fc
      on fc.formation_id = st.formation_id
     and fc.cell_index   = sa.formation_cell_index
    where st.id = p_step_b_id
  ),
  counts as (
    select (select count(*) from points_a) as n_a,
           (select count(*) from points_b) as n_b
  ),
  rot_a as (
    select 0   as rot, x,  y  from points_a
    union all
    select 90  as rot, -y, x  from points_a
    union all
    select 180 as rot, -x, -y from points_a
    union all
    select 270 as rot,  y, -x from points_a
  ),
  diffs as (
    select ra.rot,
           (pb.x - ra.x) as dx,
           (pb.y - ra.y) as dy
    from rot_a ra
    cross join points_b pb
  ),
  grouped as (
    select rot, dx, dy, count(*) as c
    from diffs
    group by rot, dx, dy
  ),
  best as (
    select rot as rotation_deg, dx as tx, dy as ty, c as max_overlap_count,
           row_number() over (order by c desc, rot asc, dx asc, dy asc) as rn
    from grouped
  )
  select n_a, n_b,
         b.rotation_deg, b.tx, b.ty, b.max_overlap_count
  into v_n_a, v_n_b,
       v_rot, v_tx, v_ty, v_c
  from counts, best b
  where b.rn = 1;

  if v_n_a is null or v_n_b is null or v_n_a = 0 or v_n_b = 0 then
    raise exception 'both steps must have assignments';
  end if;

  v_n   := least(v_n_a, v_n_b);
  v_thr := floor(v_n::numeric / 4.0)::int; -- floor(0.25*N)
  v_diff := (v_c <= v_thr);

  insert into public.adjacency_checks (
    sequence_id, step_a_id, step_b_id,
    rotation_deg, tx, ty, max_overlap_count, n_size, threshold, different, computed_at
  )
  values (
    v_seq, p_step_a_id, p_step_b_id,
    v_rot, v_tx, v_ty, v_c, v_n, v_thr, v_diff, now()
  )
  on conflict (step_a_id, step_b_id)
  do update set
    sequence_id       = excluded.sequence_id,
    rotation_deg      = excluded.rotation_deg,
    tx                = excluded.tx,
    ty                = excluded.ty,
    max_overlap_count = excluded.max_overlap_count,
    n_size            = excluded.n_size,
    threshold         = excluded.threshold,
    different         = excluded.different,
    computed_at       = excluded.computed_at;

  rotation_deg := v_rot;
  tx := v_tx;
  ty := v_ty;
  max_overlap_count := v_c;
  n_size := v_n;
  threshold := v_thr;
  different := v_diff;
  return next;
end
$$;


ALTER FUNCTION "public"."compute_and_cache_adjacency"("p_step_a_id" "uuid", "p_step_b_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_formation"("p_title" "text", "p_notes" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_id uuid;
begin
  if coalesce(trim(p_title),'') = '' then
    raise exception 'title required';
  end if;

  insert into public.formations (owner_user_id, title, notes)
  values (auth.uid(), trim(p_title), p_notes)
  returning id into v_id;

  return v_id;
end$$;


ALTER FUNCTION "public"."create_formation"("p_title" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_sequence"("p_title" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare v_id uuid;
begin
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'title is required';
  end if;

  insert into public.sequences (title, owner_user_id)
  values (trim(p_title), auth.uid())
  returning id into v_id;

  return v_id;
end
$$;


ALTER FUNCTION "public"."create_sequence"("p_title" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."db_now"() RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    AS $$ select now(); $$;


ALTER FUNCTION "public"."db_now"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_step_and_compact"("p_sequence_id" "uuid", "p_step_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid;
  v_seq_of_step uuid;
begin
  -- Auth: owner-only
  select owner_user_id into v_owner from public.sequences where id = p_sequence_id;
  if v_owner is null then
    raise exception 'sequence not found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'not authorized (owner)';
  end if;

  -- Validate the step belongs to the sequence
  select sequence_id into v_seq_of_step
  from public.sequence_steps
  where id = p_step_id;

  if v_seq_of_step is null then
    raise exception 'step not found';
  end if;
  if v_seq_of_step <> p_sequence_id then
    raise exception 'step does not belong to this sequence';
  end if;

  -- Delete the step (cascades remove step_assignments; adjacency_checks rows
  -- also cascade via FKs on step_a_id / step_b_id)
  delete from public.sequence_steps where id = p_step_id;

  -- Compact remaining step_index to 1..N in order
  with ordered as (
    select id, row_number() over (order by step_index asc) as new_idx
    from public.sequence_steps
    where sequence_id = p_sequence_id
  )
  update public.sequence_steps st
  set step_index = o.new_idx
  from ordered o
  where st.id = o.id;
end
$$;


ALTER FUNCTION "public"."delete_step_and_compact"("p_sequence_id" "uuid", "p_step_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."formations_matching_roster"("p_sequence_id" "uuid") RETURNS TABLE("id" "uuid", "title" "text", "cell_count" integer)
    LANGUAGE "sql"
    SET "search_path" TO 'public'
    AS $$
  with my_seq as (
    select id, owner_user_id
    from public.sequences
    where id = p_sequence_id
  ),
  roster_size as (
    select count(*)::int as n
    from public.sequence_roster
    where sequence_id = p_sequence_id
  ),
  form_counts as (
    select f.id, f.title, f.created_at, count(fc.*)::int as cell_count
    from public.formations f
    join public.formation_cells fc on fc.formation_id = f.id
    join my_seq s on s.owner_user_id = f.owner_user_id   -- same owner
    group by f.id, f.title, f.created_at
  )
  select fc.id, fc.title, fc.cell_count
  from form_counts fc, roster_size r
  where fc.cell_count = r.n
  order by fc.created_at desc;
$$;


ALTER FUNCTION "public"."formations_matching_roster"("p_sequence_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_formation_cells"("p_formation_id" "uuid", "p_cells" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid;
  v_total int;
  v_reached int;
begin
  -- Ownership / visibility check (RLS still applies under SECURITY INVOKER)
  select owner_user_id into v_owner
  from public.formations
  where id = p_formation_id;

  if v_owner is null then
    raise exception 'formation not found';
  end if;

  if v_owner <> auth.uid() then
    raise exception 'not authorized (must be owner)';
  end if;

  -- Connectivity check (4-neighbor). Use UNION (dedup) to avoid self-subquery.
  with recursive
  input_cells as (
    select distinct (x.col)::int as col, (x.row)::int as row
    from jsonb_to_recordset(p_cells) as x(col int, row int)
  ),
  counts as ( select count(*) as total from input_cells ),
  start_cell as ( select col, row from input_cells limit 1 ),
  reachable(col, row) as (
    select col, row from start_cell
    union
    select ic.col, ic.row
    from input_cells ic
    join reachable r
      on (ic.col = r.col + 1 and ic.row = r.row)
      or (ic.col = r.col - 1 and ic.row = r.row)
      or (ic.col = r.col and ic.row = r.row + 1)
      or (ic.col = r.col and ic.row = r.row - 1)
  ),
  reached as ( select count(*) as n from reachable )
  select total, n into v_total, v_reached from counts, reached;

  if v_total = 0 then
    raise exception 'must include at least one cell';
  end if;

  if v_total <> v_reached then
    raise exception 'cells must form a 4-neighbor connected shape';
  end if;

  -- Replace cells atomically and deterministically index them (0-based)
  delete from public.formation_cells where formation_id = p_formation_id;

  insert into public.formation_cells (formation_id, cell_index, col, row)
  select
    p_formation_id,
    row_number() over (order by col, row) - 1,
    col, row
  from (
    select distinct (x.col)::int as col, (x.row)::int as row
    from jsonb_to_recordset(p_cells) as x(col int, row int)
  ) src;

  -- Bump version for cache-busting / future history
  update public.formations set version = version + 1 where id = p_formation_id;
end
$$;


ALTER FUNCTION "public"."save_formation_cells"("p_formation_id" "uuid", "p_cells" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_sequence_roster"("p_sequence_id" "uuid", "p_roster" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid;
  v_count int;
begin
  select owner_user_id into v_owner from public.sequences where id = p_sequence_id;
  if v_owner is null then raise exception 'sequence not found'; end if;
  if v_owner <> auth.uid() then raise exception 'not authorized (owner)'; end if;

  -- Dedup and preserve first-seen order
  with raw as (
    select x as flyer_id, ord
    from jsonb_array_elements_text(p_roster) with ordinality as t(x, ord)
  ),
  cleaned as (
    select min(ord) as ord, trim(flyer_id) as flyer_id
    from raw
    where trim(flyer_id) <> ''
    group by trim(flyer_id)
  ),
  cnt as (select count(*)::int as c from cleaned)
  select c into v_count from cnt;

  if v_count = 0 then
    raise exception 'roster cannot be empty';
  end if;

  delete from public.sequence_roster where sequence_id = p_sequence_id;

  insert into public.sequence_roster (sequence_id, flyer_id, roster_index)
  select p_sequence_id, flyer_id, row_number() over (order by ord) - 1
  from cleaned;
end
$$;


ALTER FUNCTION "public"."save_sequence_roster"("p_sequence_id" "uuid", "p_roster" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."swap_step_flyers"("p_sequence_step_id" "uuid", "p_flyer_a" "text", "p_flyer_b" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  v_seq uuid;
  v_owner uuid;
  a_idx int;
  b_idx int;
begin
  -- Authorize owner via parent sequence (matches your RLS model)
  select st.sequence_id, s.owner_user_id
    into v_seq, v_owner
  from public.sequence_steps st
  join public.sequences s on s.id = st.sequence_id
  where st.id = p_sequence_step_id;

  if v_seq is null then
    raise exception 'step not found';
  end if;
  if v_owner <> auth.uid() then
    raise exception 'not authorized (owner)';
  end if;

  -- No-op if same flyer
  if trim(p_flyer_a) = trim(p_flyer_b) then
    return;
  end if;

  -- Get current cell indices
  select formation_cell_index
    into a_idx
  from public.step_assignments
  where sequence_step_id = p_sequence_step_id and flyer_id = p_flyer_a;

  select formation_cell_index
    into b_idx
  from public.step_assignments
  where sequence_step_id = p_sequence_step_id and flyer_id = p_flyer_b;

  if a_idx is null or b_idx is null then
    raise exception 'both flyers must currently be assigned in this step';
  end if;

  -- Two-phase swap to avoid unique constraint collisions
  update public.step_assignments
  set formation_cell_index = formation_cell_index + 1000000
  where sequence_step_id = p_sequence_step_id
    and flyer_id in (p_flyer_a, p_flyer_b);

  update public.step_assignments
  set formation_cell_index = case
    when flyer_id = p_flyer_a then b_idx
    when flyer_id = p_flyer_b then a_idx
    else formation_cell_index
  end
  where sequence_step_id = p_sequence_step_id
    and flyer_id in (p_flyer_a, p_flyer_b);
end
$$;


ALTER FUNCTION "public"."swap_step_flyers"("p_sequence_step_id" "uuid", "p_flyer_a" "text", "p_flyer_b" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_sequences_after_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.sequence_members (sequence_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner')
  on conflict do nothing;
  return new;
end$$;


ALTER FUNCTION "public"."tg_sequences_after_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tg_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end$$;


ALTER FUNCTION "public"."tg_set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."adjacency_checks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sequence_id" "uuid" NOT NULL,
    "step_a_id" "uuid" NOT NULL,
    "step_b_id" "uuid" NOT NULL,
    "rotation_deg" integer NOT NULL,
    "tx" integer NOT NULL,
    "ty" integer NOT NULL,
    "max_overlap_count" integer NOT NULL,
    "n_size" integer NOT NULL,
    "threshold" integer NOT NULL,
    "different" boolean NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "adjacency_checks_rotation_deg_check" CHECK (("rotation_deg" = ANY (ARRAY[0, 90, 180, 270])))
);


ALTER TABLE "public"."adjacency_checks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."formation_cells" (
    "formation_id" "uuid" NOT NULL,
    "cell_index" integer NOT NULL,
    "col" integer NOT NULL,
    "row" integer NOT NULL
);


ALTER TABLE "public"."formation_cells" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."formations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "version" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."formations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sequence_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sequence_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sequence_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'organizer'::"text", 'judge'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."sequence_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sequence_roster" (
    "sequence_id" "uuid" NOT NULL,
    "flyer_id" "text" NOT NULL,
    "roster_index" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sequence_roster" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sequence_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "sequence_id" "uuid" NOT NULL,
    "step_index" integer NOT NULL,
    "formation_id" "uuid" NOT NULL,
    "label" "text",
    "offset_tx" integer DEFAULT 0 NOT NULL,
    "offset_ty" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sequence_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sequences" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'planning'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sequences_status_check" CHECK (("status" = ANY (ARRAY['planning'::"text", 'judging'::"text", 'locked'::"text"])))
);


ALTER TABLE "public"."sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."step_assignments" (
    "sequence_step_id" "uuid" NOT NULL,
    "flyer_id" "text" NOT NULL,
    "formation_cell_index" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."step_assignments" OWNER TO "postgres";


ALTER TABLE ONLY "public"."adjacency_checks"
    ADD CONSTRAINT "adjacency_checks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."adjacency_checks"
    ADD CONSTRAINT "adjacency_checks_step_a_id_step_b_id_key" UNIQUE ("step_a_id", "step_b_id");



ALTER TABLE ONLY "public"."formation_cells"
    ADD CONSTRAINT "formation_cells_formation_id_col_row_key" UNIQUE ("formation_id", "col", "row");



ALTER TABLE ONLY "public"."formation_cells"
    ADD CONSTRAINT "formation_cells_pkey" PRIMARY KEY ("formation_id", "cell_index");



ALTER TABLE ONLY "public"."formations"
    ADD CONSTRAINT "formations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sequence_members"
    ADD CONSTRAINT "sequence_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sequence_members"
    ADD CONSTRAINT "sequence_members_sequence_id_user_id_key" UNIQUE ("sequence_id", "user_id");



ALTER TABLE ONLY "public"."sequence_roster"
    ADD CONSTRAINT "sequence_roster_pkey" PRIMARY KEY ("sequence_id", "flyer_id");



ALTER TABLE ONLY "public"."sequence_roster"
    ADD CONSTRAINT "sequence_roster_sequence_id_roster_index_key" UNIQUE ("sequence_id", "roster_index");



ALTER TABLE ONLY "public"."sequence_steps"
    ADD CONSTRAINT "sequence_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sequence_steps"
    ADD CONSTRAINT "sequence_steps_sequence_id_step_index_key" UNIQUE ("sequence_id", "step_index");



ALTER TABLE ONLY "public"."sequences"
    ADD CONSTRAINT "sequences_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."step_assignments"
    ADD CONSTRAINT "step_assignments_pkey" PRIMARY KEY ("sequence_step_id", "flyer_id");



ALTER TABLE ONLY "public"."step_assignments"
    ADD CONSTRAINT "step_assignments_sequence_step_id_formation_cell_index_key" UNIQUE ("sequence_step_id", "formation_cell_index");



CREATE OR REPLACE TRIGGER "sequences_after_insert" AFTER INSERT ON "public"."sequences" FOR EACH ROW EXECUTE FUNCTION "public"."tg_sequences_after_insert"();



CREATE OR REPLACE TRIGGER "set_updated_at" BEFORE UPDATE ON "public"."sequences" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_formations" BEFORE UPDATE ON "public"."formations" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_updated_at"();



CREATE OR REPLACE TRIGGER "set_updated_at_sequence_steps" BEFORE UPDATE ON "public"."sequence_steps" FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_updated_at"();



ALTER TABLE ONLY "public"."adjacency_checks"
    ADD CONSTRAINT "adjacency_checks_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."adjacency_checks"
    ADD CONSTRAINT "adjacency_checks_step_a_id_fkey" FOREIGN KEY ("step_a_id") REFERENCES "public"."sequence_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."adjacency_checks"
    ADD CONSTRAINT "adjacency_checks_step_b_id_fkey" FOREIGN KEY ("step_b_id") REFERENCES "public"."sequence_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."formation_cells"
    ADD CONSTRAINT "formation_cells_formation_id_fkey" FOREIGN KEY ("formation_id") REFERENCES "public"."formations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."formations"
    ADD CONSTRAINT "formations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sequence_members"
    ADD CONSTRAINT "sequence_members_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sequence_members"
    ADD CONSTRAINT "sequence_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sequence_roster"
    ADD CONSTRAINT "sequence_roster_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sequence_steps"
    ADD CONSTRAINT "sequence_steps_formation_id_fkey" FOREIGN KEY ("formation_id") REFERENCES "public"."formations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sequence_steps"
    ADD CONSTRAINT "sequence_steps_sequence_id_fkey" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sequences"
    ADD CONSTRAINT "sequences_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."step_assignments"
    ADD CONSTRAINT "step_assignments_sequence_step_id_fkey" FOREIGN KEY ("sequence_step_id") REFERENCES "public"."sequence_steps"("id") ON DELETE CASCADE;



CREATE POLICY "ac_delete_owner" ON "public"."adjacency_checks" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "adjacency_checks"."step_a_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "ac_insert_owner" ON "public"."adjacency_checks" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "adjacency_checks"."step_a_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "ac_select_owner" ON "public"."adjacency_checks" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "adjacency_checks"."step_a_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "ac_update_owner" ON "public"."adjacency_checks" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "adjacency_checks"."step_a_id") AND ("s"."owner_user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "adjacency_checks"."step_a_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."adjacency_checks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."formation_cells" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "formation_cells_delete_via_parent" ON "public"."formation_cells" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."formations" "f"
  WHERE (("f"."id" = "formation_cells"."formation_id") AND ("f"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "formation_cells_insert_via_parent" ON "public"."formation_cells" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."formations" "f"
  WHERE (("f"."id" = "formation_cells"."formation_id") AND ("f"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "formation_cells_select_via_parent" ON "public"."formation_cells" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."formations" "f"
  WHERE (("f"."id" = "formation_cells"."formation_id") AND ("f"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "formation_cells_update_via_parent" ON "public"."formation_cells" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."formations" "f"
  WHERE (("f"."id" = "formation_cells"."formation_id") AND ("f"."owner_user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."formations" "f"
  WHERE (("f"."id" = "formation_cells"."formation_id") AND ("f"."owner_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."formations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "formations_delete_own" ON "public"."formations" FOR DELETE TO "authenticated" USING (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "formations_insert_own" ON "public"."formations" FOR INSERT TO "authenticated" WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "formations_select_own" ON "public"."formations" FOR SELECT TO "authenticated" USING (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "formations_update_own" ON "public"."formations" FOR UPDATE TO "authenticated" USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "sa_delete_owner" ON "public"."step_assignments" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "step_assignments"."sequence_step_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sa_insert_owner" ON "public"."step_assignments" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "step_assignments"."sequence_step_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sa_select_owner" ON "public"."step_assignments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "step_assignments"."sequence_step_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sa_update_owner" ON "public"."step_assignments" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "step_assignments"."sequence_step_id") AND ("s"."owner_user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."sequence_steps" "st"
     JOIN "public"."sequences" "s" ON (("s"."id" = "st"."sequence_id")))
  WHERE (("st"."id" = "step_assignments"."sequence_step_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."sequence_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sequence_roster" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sequence_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sequences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sequences_delete_only_owner" ON "public"."sequences" FOR DELETE TO "authenticated" USING (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "sequences_insert_owner_is_self" ON "public"."sequences" FOR INSERT TO "authenticated" WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "sequences_select_members" ON "public"."sequences" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sequence_members" "m"
  WHERE (("m"."sequence_id" = "sequences"."id") AND ("m"."user_id" = "auth"."uid"())))));



CREATE POLICY "sequences_update_only_owner" ON "public"."sequences" FOR UPDATE TO "authenticated" USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "sm_delete_self" ON "public"."sequence_members" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "sm_select_self" ON "public"."sequence_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "sr_delete_owner" ON "public"."sequence_roster" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_roster"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sr_insert_owner" ON "public"."sequence_roster" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_roster"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sr_select_owner" ON "public"."sequence_roster" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_roster"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sr_update_owner" ON "public"."sequence_roster" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_roster"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_roster"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sst_delete_owner" ON "public"."sequence_steps" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_steps"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sst_insert_owner" ON "public"."sequence_steps" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_steps"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sst_select_owner" ON "public"."sequence_steps" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_steps"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "sst_update_owner" ON "public"."sequence_steps" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_steps"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."sequences" "s"
  WHERE (("s"."id" = "sequence_steps"."sequence_id") AND ("s"."owner_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."step_assignments" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."add_sequence_step"("p_sequence_id" "uuid", "p_formation_id" "uuid", "p_label" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_sequence_step"("p_sequence_id" "uuid", "p_formation_id" "uuid", "p_label" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_sequence_step"("p_sequence_id" "uuid", "p_formation_id" "uuid", "p_label" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."auto_assign_step"("p_sequence_step_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."auto_assign_step"("p_sequence_step_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_assign_step"("p_sequence_step_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_adjacency_for_sequence"("p_sequence_id" "uuid", "p_wrap" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."compute_adjacency_for_sequence"("p_sequence_id" "uuid", "p_wrap" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_adjacency_for_sequence"("p_sequence_id" "uuid", "p_wrap" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_and_cache_adjacency"("p_step_a_id" "uuid", "p_step_b_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_and_cache_adjacency"("p_step_a_id" "uuid", "p_step_b_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_and_cache_adjacency"("p_step_a_id" "uuid", "p_step_b_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_formation"("p_title" "text", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_formation"("p_title" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_formation"("p_title" "text", "p_notes" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."create_sequence"("p_title" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_sequence"("p_title" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_sequence"("p_title" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."db_now"() TO "anon";
GRANT ALL ON FUNCTION "public"."db_now"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."db_now"() TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_step_and_compact"("p_sequence_id" "uuid", "p_step_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."delete_step_and_compact"("p_sequence_id" "uuid", "p_step_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_step_and_compact"("p_sequence_id" "uuid", "p_step_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."formations_matching_roster"("p_sequence_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."formations_matching_roster"("p_sequence_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."formations_matching_roster"("p_sequence_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_formation_cells"("p_formation_id" "uuid", "p_cells" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_formation_cells"("p_formation_id" "uuid", "p_cells" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_formation_cells"("p_formation_id" "uuid", "p_cells" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."save_sequence_roster"("p_sequence_id" "uuid", "p_roster" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."save_sequence_roster"("p_sequence_id" "uuid", "p_roster" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_sequence_roster"("p_sequence_id" "uuid", "p_roster" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."swap_step_flyers"("p_sequence_step_id" "uuid", "p_flyer_a" "text", "p_flyer_b" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."swap_step_flyers"("p_sequence_step_id" "uuid", "p_flyer_a" "text", "p_flyer_b" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."swap_step_flyers"("p_sequence_step_id" "uuid", "p_flyer_a" "text", "p_flyer_b" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_sequences_after_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_sequences_after_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_sequences_after_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."tg_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."tg_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."tg_set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."adjacency_checks" TO "anon";
GRANT ALL ON TABLE "public"."adjacency_checks" TO "authenticated";
GRANT ALL ON TABLE "public"."adjacency_checks" TO "service_role";



GRANT ALL ON TABLE "public"."formation_cells" TO "anon";
GRANT ALL ON TABLE "public"."formation_cells" TO "authenticated";
GRANT ALL ON TABLE "public"."formation_cells" TO "service_role";



GRANT ALL ON TABLE "public"."formations" TO "anon";
GRANT ALL ON TABLE "public"."formations" TO "authenticated";
GRANT ALL ON TABLE "public"."formations" TO "service_role";



GRANT ALL ON TABLE "public"."sequence_members" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."sequence_members" TO "authenticated";
GRANT ALL ON TABLE "public"."sequence_members" TO "service_role";



GRANT ALL ON TABLE "public"."sequence_roster" TO "anon";
GRANT ALL ON TABLE "public"."sequence_roster" TO "authenticated";
GRANT ALL ON TABLE "public"."sequence_roster" TO "service_role";



GRANT ALL ON TABLE "public"."sequence_steps" TO "anon";
GRANT ALL ON TABLE "public"."sequence_steps" TO "authenticated";
GRANT ALL ON TABLE "public"."sequence_steps" TO "service_role";



GRANT ALL ON TABLE "public"."sequences" TO "anon";
GRANT ALL ON TABLE "public"."sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."sequences" TO "service_role";



GRANT ALL ON TABLE "public"."step_assignments" TO "anon";
GRANT ALL ON TABLE "public"."step_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."step_assignments" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







RESET ALL;
