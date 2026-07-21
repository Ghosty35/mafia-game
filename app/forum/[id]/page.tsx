'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { usePlayer } from '../../components/PlayerContext';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import Panel from '../../components/Panel';

export const dynamic = 'force-dynamic';

type Reply = {
  id: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type PostDetail = {
  id: string;
  category_id: string;
  author_id: string;
  author_name: string;
  title: string;
  content: string;
  is_pinned: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
  replies: Reply[];
};

const CATEGORY_ICONS: Record<string, string> = {
  general: '💬',
  recruitment: '🤝',
  announcements: '📢',
};

export default function ForumPostPage() {
  const params = useParams();
  const postId = params?.id as string;
  const { player, refreshPlayer } = usePlayer();
  const { t } = useLanguage();
  const supabase = createClient();

  const [post, setPost] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyContent, setReplyContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadPost = useCallback(async () => {
    const { data } = await supabase.rpc('get_forum_post', { p_post_id: postId });
    if (data) setPost(data as PostDetail);
    setLoading(false);
  }, [supabase, postId]);

  useEffect(() => {
    if (postId) {
      loadPost();
    }
  }, [postId, loadPost]);

  const handleReply = async () => {
    if (!player || !post) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.rpc('create_forum_reply', {
      p_post_id: postId,
      p_content: replyContent,
    });
    setBusy(false);
    if (err) {
      if (err.message.includes('BANNED')) setError(t('dl_err_banned'));
      else if (err.message.includes('TIMED_OUT')) setError(t('dl_err_timed_out'));
      else if (err.message.includes('CONTENT_TOO_SHORT')) setError('Reply cannot be empty.');
      else setError(err.message || 'Failed to post reply.');
      return;
    }
    setReplyContent('');
    await loadPost();
    if (refreshPlayer) await refreshPlayer();
  };

  if (loading) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('loading')}</div>;
  if (!post) return <div className="max-w-4xl mx-auto p-6 text-zinc-400 text-sm">{t('forum_post_not_found')}</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/forum" className="text-sm text-red-400 hover:text-red-300 transition-colors">
          ← {t('forum_back')}
        </Link>
        <span className="text-zinc-600">|</span>
        <span className="text-sm text-zinc-400">
          {CATEGORY_ICONS[post.category_id] || '📄'} {post.category_id}
        </span>
      </div>

      {/* Post */}
      <Panel title={post.title} icon={CATEGORY_ICONS[post.category_id] || '📄'} bodyClassName="p-0">
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <span className="text-zinc-300 font-medium">{post.author_name}</span>
            <span>•</span>
            <span>{new Date(post.created_at).toLocaleString()}</span>
            {post.is_pinned && <span className="px-1.5 py-0.5 bg-amber-900/50 text-amber-300 rounded text-[10px] font-semibold">PINNED</span>}
            {post.is_locked && <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded text-[10px] font-semibold">LOCKED</span>}
          </div>
          <div className="text-sm text-zinc-200 whitespace-pre-wrap">{post.content}</div>
        </div>
      </Panel>

      {/* Replies */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-400">
          {t('forum_replies')} ({post.replies.length})
        </h3>
        {post.replies.length === 0 && (
          <div className="text-sm text-zinc-500 px-4 py-6 text-center">{t('forum_no_replies')}</div>
        )}
        {post.replies.map((reply) => (
          <div key={reply.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500 mb-1">
              <span className="text-zinc-300 font-medium">{reply.author_name}</span>
              <span>•</span>
              <span>{new Date(reply.created_at).toLocaleString()}</span>
            </div>
            <div className="text-sm text-zinc-200 whitespace-pre-wrap">{reply.content}</div>
          </div>
        ))}
      </div>

      {/* Reply Form */}
      {!post.is_locked && (
        <Panel title={t('forum_reply_title')} icon="💬">
          <div className="space-y-3">
            <textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder={t('forum_reply_placeholder')}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm h-24 resize-y"
              maxLength={5000}
            />
            {error && <div className="text-red-400 text-xs">{error}</div>}
            <button
              onClick={handleReply}
              disabled={busy || !replyContent.trim()}
              className="w-full py-2.5 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {busy ? t('forum_posting') : t('forum_reply_button')}
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}
