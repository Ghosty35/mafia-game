-- ============================================================
-- Bulletstar-style Family Bank + Pending Donations System
-- 
-- - Donations go to PENDING bank first.
-- - Managers (and higher) can see pending donations list (who, how much, when).
-- - Accountant (and Boss/Underboss) can ACCEPT pending donations → moves to family bank + adds respect.
-- - Members can see the donation history (limited view).
-- - Underboss has almost full Boss powers for family/member matters (except deleting family).
-- - Bank + donations build Family Power (for future wars, weapons, etc.).
-- ============================================================

-- Add pending_bank to families
ALTER TABLE public.families 
ADD COLUMN IF NOT EXISTS pending_bank bigint NOT NULL DEFAULT 0;

-- Pending donations table (history + for acceptance)
CREATE TABLE IF NOT EXISTS public.family_pending_donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  donated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS (basic)
ALTER TABLE public.family_pending_donations ENABLE ROW LEVEL SECURITY;

-- Policy: family members can view their family's pending donations
CREATE POLICY "Family members can view their pending donations"
  ON public.family_pending_donations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.players p 
      WHERE p.id = auth.uid() AND p.family_id = family_pending_donations.family_id
    )
  );

-- Update donate function: now puts in PENDING bank
CREATE OR REPLACE FUNCTION public.donate_to_family(amount bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_cash bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN
    RAISE EXCEPTION 'NOT_IN_FAMILY';
  END IF;

  SELECT cash INTO my_cash FROM public.players WHERE id = auth.uid();
  IF my_cash < amount OR amount <= 0 THEN
    RAISE EXCEPTION 'NOT_ENOUGH_CASH';
  END IF;

  -- Deduct from player
  UPDATE public.players SET cash = cash - amount WHERE id = auth.uid();

  -- Add to PENDING bank (not yet in main bank)
  UPDATE public.families 
  SET pending_bank = pending_bank + amount
  WHERE id = my_family_id;

  -- Record the pending donation
  INSERT INTO public.family_pending_donations (family_id, player_id, amount)
  VALUES (my_family_id, auth.uid(), amount);

  RETURN jsonb_build_object(
    'success', true,
    'donated', amount,
    'status', 'pending'
  );
END;
$$;

-- Accept pending donation (Accountant + Boss + Underboss)
-- Moves from pending_bank to bank + gives respect
CREATE OR REPLACE FUNCTION public.accept_pending_donation(donation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  donation record;
  respect_gain bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN
    RAISE EXCEPTION 'NOT_IN_FAMILY';
  END IF;

  SELECT role INTO my_role FROM public.family_members 
  WHERE family_id = my_family_id AND player_id = auth.uid();

  -- Only Accountant, Boss, Underboss can accept
  IF my_role NOT IN ('accountant', 'boss', 'underboss') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_TO_ACCEPT';
  END IF;

  -- Get the donation
  SELECT * INTO donation FROM public.family_pending_donations 
  WHERE id = donation_id AND family_id = my_family_id;

  IF donation.id IS NULL THEN
    RAISE EXCEPTION 'DONATION_NOT_FOUND';
  END IF;

  -- Move from pending to main bank
  UPDATE public.families 
  SET 
    bank = bank + donation.amount,
    pending_bank = GREATEST(0, pending_bank - donation.amount),
    respect = respect + GREATEST(1, floor(donation.amount / 10))
  WHERE id = my_family_id;

  -- Delete the pending record (accepted)
  DELETE FROM public.family_pending_donations WHERE id = donation_id;

  respect_gain := GREATEST(1, floor(donation.amount / 10));

  RETURN jsonb_build_object(
    'success', true,
    'accepted_amount', donation.amount,
    'respect_gained', respect_gain
  );
END;
$$;

-- Get pending donations for the family (for managers + higher, and visible to members)
CREATE OR REPLACE FUNCTION public.get_family_pending_donations()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'username', p.username,
        'amount', d.amount,
        'donated_at', d.donated_at
      ) ORDER BY d.donated_at DESC
    ),
    '[]'::jsonb
  )
  FROM public.family_pending_donations d
  JOIN public.players p ON p.id = d.player_id
  WHERE d.family_id = (
    SELECT family_id FROM public.players WHERE id = auth.uid()
  );
$$;

-- Enhanced get_my_family to include bank + pending_bank + pending list
CREATE OR REPLACE FUNCTION public.get_my_family()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  fam public.families;
  pending_list jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT f.* INTO fam
  FROM public.families f
  JOIN public.players p ON p.family_id = f.id
  WHERE p.id = auth.uid();

  IF fam.id IS NULL THEN
    RETURN jsonb_build_object(
      'family', null, 
      'my_role', null, 
      'members', '[]'::jsonb, 
      'bank', 0,
      'pending_bank', 0,
      'pending_donations', '[]'::jsonb
    );
  END IF;

  pending_list := (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'username', p.username,
          'amount', d.amount,
          'donated_at', d.donated_at
        ) ORDER BY d.donated_at DESC
      ),
      '[]'::jsonb
    )
    FROM public.family_pending_donations d
    JOIN public.players p ON p.id = d.player_id
    WHERE d.family_id = fam.id
  );

  RETURN jsonb_build_object(
    'family', to_jsonb(fam),
    'my_role', (
      SELECT role FROM public.family_members 
      WHERE family_id = fam.id AND player_id = auth.uid()
    ),
    'bank', fam.bank,
    'pending_bank', fam.pending_bank,
    'pending_donations', pending_list,
    'members', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'player_id', pl.id,
          'username', pl.username,
          'role', fm.role
        )
        ORDER BY 
          CASE fm.role 
            WHEN 'boss' THEN 1 
            WHEN 'underboss' THEN 2 
            WHEN 'accountant' THEN 3 
            WHEN 'manager' THEN 4 
            WHEN 'caporegime' THEN 5 
            WHEN 'soldier' THEN 6 
            ELSE 7 
          END, pl.username
      ), '[]'::jsonb)
      FROM public.family_members fm
      JOIN public.players pl ON pl.id = fm.player_id
      WHERE fm.family_id = fam.id
      LIMIT 50
    )
  );
END;
$$;

-- Kick member function (for Boss and Underboss)
CREATE OR REPLACE FUNCTION public.kick_member(p_target_player_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  target_family_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN
    RAISE EXCEPTION 'NOT_IN_FAMILY';
  END IF;

  SELECT role INTO my_role FROM public.family_members 
  WHERE family_id = my_family_id AND player_id = auth.uid();

  -- Only Boss and Underboss can kick
  IF my_role NOT IN ('boss', 'underboss') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED_TO_KICK';
  END IF;

  SELECT family_id INTO target_family_id FROM public.family_members 
  WHERE player_id = p_target_player_id;

  IF target_family_id IS NULL OR target_family_id != my_family_id THEN
    RAISE EXCEPTION 'PLAYER_NOT_IN_YOUR_FAMILY';
  END IF;

  IF p_target_player_id = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_KICK_SELF';
  END IF;

  DELETE FROM public.family_members 
  WHERE family_id = my_family_id AND player_id = p_target_player_id;

  UPDATE public.players SET family_id = NULL WHERE id = p_target_player_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Update promote to allow Underboss full management (except some limits)
CREATE OR REPLACE FUNCTION public.promote_member(
  p_target_player_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  my_family_id uuid;
  my_role text;
  target_role text;
  target_family_id uuid;
  manager_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT family_id INTO my_family_id FROM public.players WHERE id = auth.uid();
  IF my_family_id IS NULL THEN
    RAISE EXCEPTION 'NOT_IN_FAMILY';
  END IF;

  SELECT role INTO my_role FROM public.family_members 
  WHERE family_id = my_family_id AND player_id = auth.uid();

  -- Boss + Underboss have full member management
  -- Managers limited
  IF NOT (my_role IN ('boss', 'underboss', 'manager')) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  IF my_role = 'manager' AND p_new_role NOT IN ('soldier', 'associate') THEN
    RAISE EXCEPTION 'MANAGERS_CAN_ONLY_MANAGE_LOWER_ROLES';
  END IF;

  SELECT family_id, role INTO target_family_id, target_role 
  FROM public.family_members 
  WHERE player_id = p_target_player_id;

  IF target_family_id IS NULL OR target_family_id != my_family_id THEN
    RAISE EXCEPTION 'PLAYER_NOT_IN_YOUR_FAMILY';
  END IF;

  IF p_target_player_id = auth.uid() THEN
    RAISE EXCEPTION 'CANNOT_PROMOTE_SELF';
  END IF;

  IF p_new_role = 'manager' THEN
    SELECT COUNT(*) INTO manager_count 
    FROM public.family_members 
    WHERE family_id = my_family_id AND role = 'manager';
    IF manager_count >= 2 THEN
      RAISE EXCEPTION 'MAX_2_MANAGERS';
    END IF;
  END IF;

  UPDATE public.family_members
  SET role = p_new_role
  WHERE family_id = my_family_id AND player_id = p_target_player_id;

  RETURN jsonb_build_object('success', true, 'new_role', p_new_role);
END;
$$;