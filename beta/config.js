// Public endpoint of the Supabase Edge Function. Not a secret: calls still need the access code.
// Storage namespace. The beta build (scripts/deploy.sh beta) switches this to "lean-beta"
// so testing never touches the live app's data on the same phone.
export const STORAGE = "lean-beta";

export const FUNCTION_URL = "https://iuwgetnugmpeyelztnvq.supabase.co/functions/v1/lean-food-ai";
