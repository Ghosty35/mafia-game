'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export type TicketReply = {
  id: string;
  body: string;
  is_staff: boolean;
  author: string | null;
  created_at: string;
};

export type Ticket = {
  id: string;
  kind: 'support' | 'bug' | 'report';
  subject: string;
  body: string;
  status: 'open' | 'answered' | 'closed';
  target: string | null;
  created_at: string;
  updated_at: string;
  replies: TicketReply[];
};

// Shared by /support, /report and /tickets — all three are the same table
// with a different kind, so they read from one place.
export function useTickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc('get_my_tickets');
    setTickets(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  return { tickets, loading, reload };
}

/** Maps an open_ticket/reply_ticket error to a translation key. */
export function ticketErrorKey(message: string): string {
  if (message.includes('TARGET_NOT_FOUND')) return 'tk_err_target';
  if (message.includes('CANNOT_REPORT_SELF')) return 'tk_err_self';
  if (message.includes('TARGET_REQUIRED')) return 'tk_err_target_required';
  if (message.includes('TOO_MANY_OPEN')) return 'tk_err_too_many';
  if (message.includes('SUBJECT_TOO_SHORT')) return 'tk_err_subject';
  if (message.includes('BODY_TOO_SHORT')) return 'tk_err_body';
  if (message.includes('TOO_LONG')) return 'tk_err_long';
  if (message.includes('TICKET_CLOSED')) return 'tk_err_closed';
  return 'tk_err_generic';
}
