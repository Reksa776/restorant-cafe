/**
 * PUT /api/admin/wallet/bank
 *
 * Backward-compatible alias of PUT /api/admin/wallet/profile: the payout form
 * now saves owner KYC + bank account together, so both paths share one
 * validated handler instead of drifting apart.
 */
export { PUT } from "../profile/route";
