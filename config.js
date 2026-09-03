// ============================================================
// CONFIGURAÇÃO DO CONTROLE FINANCEIRO (backend Supabase)
//
// Preencha com os dados do seu projeto Supabase:
//   Dashboard → Project Settings → API
//   - SUPABASE_URL: Project URL (ex.: https://abcdefgh.supabase.co)
//   - SUPABASE_ANON_KEY: anon public key
//
// Depois rode o schema uma vez:
//   Dashboard → SQL Editor → cole supabase/schema.sql → Run
// ============================================================
window.APP_CONFIG = {
  // URL do projeto Supabase (sem barra no final)
  SUPABASE_URL: "https://krdzqceedqanhiqmlijd.supabase.co",

  // Chave pública "anon" (é pública mesmo — a proteção real fica no RLS)
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtyZHpxY2VlZHFhbmhpcW1saWpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0MDE2NjAsImV4cCI6MjEwMzk3NzY2MH0.ar_66WVg7eH_61yX0FKOx6cocYUZCjQXfbtWT6nqcsY"
};
