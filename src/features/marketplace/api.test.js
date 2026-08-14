/**
 * Unit tests for the marketplace + seller-rating data layer. Eligibility
 * (a rating requires a real sold-to-you listing) is enforced server-side by
 * a trigger (supabase/migrations/20260814004900_marketplace_seller_ratings.sql)
 * and isn't re-tested here -- this covers the client-side contract.
 */

const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock("../../lib/supabase", () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  },
}));

import {
  getSellerRatingSummary,
  getSellerReviews,
  submitSellerRating,
  getMyUnratedPurchases,
  searchBuyers,
} from "./api";

function chain(result) {
  const builder = {
    select: jest.fn(() => builder),
    in: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => Promise.resolve(result)),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

beforeEach(() => jest.clearAllMocks());

describe("getSellerRatingSummary", () => {
  it("returns an empty object without querying when given no ids", async () => {
    const result = await getSellerRatingSummary([]);
    expect(result).toEqual({});
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("keys the summary by seller_id", async () => {
    const builder = chain({
      data: [{ seller_id: "seller-1", avg_rating: 4.5, rating_count: 2, positive_count: 2 }],
      error: null,
    });
    mockFrom.mockReturnValue(builder);

    const result = await getSellerRatingSummary(["seller-1"]);

    expect(mockFrom).toHaveBeenCalledWith("seller_rating_summary");
    expect(builder.in).toHaveBeenCalledWith("seller_id", ["seller-1"]);
    expect(result["seller-1"].avg_rating).toBe(4.5);
  });
});

describe("getSellerReviews", () => {
  it("returns [] early when the seller has no reviews (skips the profile lookup)", async () => {
    const builder = chain({ data: [], error: null });
    mockFrom.mockReturnValue(builder);

    const result = await getSellerReviews("seller-1");

    expect(result).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("resolves rater names via get_profile_snippets, not a direct profile embed", async () => {
    const reviewsBuilder = chain({
      data: [{ id: "r1", rating: 5, comment: "Great!", rater_id: "buyer-1", listing_id: "listing-1" }],
      error: null,
    });
    mockFrom.mockReturnValue(reviewsBuilder);
    mockRpc.mockResolvedValue({ data: [{ id: "buyer-1", name: "Alice", course: "CSE" }], error: null });

    const result = await getSellerReviews("seller-1");

    expect(mockRpc).toHaveBeenCalledWith("get_profile_snippets", { p_ids: ["buyer-1"] });
    expect(result[0].rater.name).toBe("Alice");
  });
});

describe("submitSellerRating", () => {
  it("calls submit_seller_rating with the right shape", async () => {
    mockRpc.mockResolvedValue({ data: { id: "rating-1", rating: 5 }, error: null });

    await submitSellerRating({ sellerId: "seller-1", listingId: "listing-1", rating: 5, comment: "Nice!" });

    expect(mockRpc).toHaveBeenCalledWith("submit_seller_rating", {
      p_seller_id: "seller-1",
      p_listing_id: "listing-1",
      p_rating: 5,
      p_comment: "Nice!",
    });
  });

  it("surfaces the eligibility-trigger error verbatim", async () => {
    // A plain {message} object here would make .rejects.toThrow() silently
    // report "did not throw" (it only recognizes real Error instances) --
    // this also matches what the real supabase-js client actually throws.
    mockRpc.mockResolvedValue({ data: null, error: new Error("SELLER_RATING_REQUIRES_PURCHASE: you can only rate a seller for a listing they sold you") });

    await expect(
      submitSellerRating({ sellerId: "seller-1", listingId: "listing-1", rating: 5 })
    ).rejects.toThrow(/SELLER_RATING_REQUIRES_PURCHASE/);
  });
});

describe("getMyUnratedPurchases", () => {
  it("calls get_my_unrated_purchases with no arguments", async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    await getMyUnratedPurchases();

    expect(mockRpc).toHaveBeenCalledWith("get_my_unrated_purchases");
  });
});

describe("searchBuyers", () => {
  it("skips the RPC call entirely for an empty query", async () => {
    const result = await searchBuyers("campus-1", "  ");

    expect(result).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("searches via search_people scoped to the campus, capped at 8 results", async () => {
    mockRpc.mockResolvedValue({ data: [{ id: "person-1", name: "Bob" }], error: null });

    await searchBuyers("campus-1", "Bob");

    expect(mockRpc).toHaveBeenCalledWith("search_people", { p_campus_id: "campus-1", p_query: "Bob", p_limit: 8 });
  });
});
