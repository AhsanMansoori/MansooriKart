import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Grid,
  Paper,
  Rating,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { fetchProduct, fetchRelatedProducts } from '../services/catalog';
import { createProductReview, fetchProductReviews } from '../services/reviews';
import { forgetVisitedProduct, recordVisitedProduct } from '../services/recentlyViewed';
import { isAuthenticated } from '../services/authSession';
import { useNotifier } from '../context/NotificationProvider';

const REVIEW_BODY_MIN = 3;
const REVIEW_BODY_MAX = 2000;
const REVIEW_TITLE_MAX = 120;

const formatCategory = value => (typeof value === 'string' && value.length ? value.charAt(0).toUpperCase() + value.slice(1) : 'Uncategorized');

const formatReviewDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
};

/**
 * The review composer.
 *
 * Only offered to a signed-in shopper, and only ever a convenience: the API authorizes the write
 * from the bearer token, rejects a second review of the same product, and decides on its own
 * whether the review counts as a verified purchase.
 */
function ReviewForm({ onSubmit, submitting }) {
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const handleSubmit = async event => {
    event.preventDefault();
    const submitted = await onSubmit({ rating, title, body });
    if (submitted) {
      setRating(5);
      setTitle('');
      setBody('');
    }
  };

  const bodyTooShort = body.trim().length > 0 && body.trim().length < REVIEW_BODY_MIN;

  return (
    <Paper variant="outlined" component="form" onSubmit={handleSubmit} sx={{ p: 3, mt: 3 }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>
        Write a review
      </Typography>
      <Stack spacing={2}>
        <Box>
          <Typography component="label" variant="body2" color="text.secondary" htmlFor="review-rating" sx={{ display: 'block', mb: 0.5 }}>
            Your rating
          </Typography>
          <Rating id="review-rating" name="review-rating" value={rating} onChange={(_event, value) => setRating(value || 1)} />
        </Box>
        <TextField
          label="Title (optional)"
          value={title}
          onChange={event => setTitle(event.target.value)}
          inputProps={{ maxLength: REVIEW_TITLE_MAX }}
          fullWidth
        />
        <TextField
          label="Your review"
          value={body}
          onChange={event => setBody(event.target.value)}
          inputProps={{ maxLength: REVIEW_BODY_MAX }}
          error={bodyTooShort}
          helperText={bodyTooShort ? `Please write at least ${REVIEW_BODY_MIN} characters.` : `${body.trim().length}/${REVIEW_BODY_MAX}`}
          multiline
          minRows={3}
          fullWidth
          required
        />
        <Box>
          <Button type="submit" variant="contained" disabled={submitting || body.trim().length < REVIEW_BODY_MIN}>
            {submitting ? 'Submitting…' : 'Submit review'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}

function ProductDetails({ addToCart }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [related, setRelated] = useState([]);
  const [relatedLoading, setRelatedLoading] = useState(true);
  const [reviews, setReviews] = useState([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [signedIn, setSignedIn] = useState(() => isAuthenticated());
  const { notify } = useNotifier();

  const loadReviews = useCallback(async productId => {
    try {
      const { rows, total } = await fetchProductReviews(productId);
      setReviews(rows);
      setReviewTotal(total);
    } catch (reviewError) {
      console.warn('Unable to load reviews', reviewError);
      setReviews([]);
    }
  }, []);

  const loadProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRelatedLoading(true);
    try {
      const loaded = await fetchProduct(id);
      if (!loaded?.id) throw new Error('Product not found');
      setProduct(loaded);
      recordVisitedProduct(loaded);
      loadReviews(loaded.id);
      try {
        setRelated(await fetchRelatedProducts(loaded));
      } catch (relatedError) {
        console.warn('Unable to load related products', relatedError);
        setRelated([]);
      } finally {
        setRelatedLoading(false);
      }
    } catch (err) {
      console.error('Error fetching product details:', err);
      setProduct(null);
      setRelated([]);
      setRelatedLoading(false);
      setError(err);
      if (err?.response?.status === 404) forgetVisitedProduct(id);
    } finally {
      setLoading(false);
    }
  }, [id, loadReviews]);

  useEffect(() => {
    loadProduct();
  }, [loadProduct]);

  useEffect(() => {
    setSignedIn(isAuthenticated());
  }, [id]);

  const handleAddToCart = useCallback(() => {
    if (product) addToCart(product);
  }, [addToCart, product]);

  const handleReviewSubmit = useCallback(
    async draft => {
      if (!product?.id) return false;
      setSubmittingReview(true);
      try {
        await createProductReview(product.id, draft);
        notify({ severity: 'success', message: 'Thanks for the review!' });
        await loadReviews(product.id);
        const refreshed = await fetchProduct(product.id).catch(() => null);
        if (refreshed?.id) setProduct(refreshed);
        return true;
      } catch (err) {
        const status = err?.response?.status;
        if (status === 401) {
          setSignedIn(false);
          notify({ severity: 'warning', message: 'Please sign in again to post a review.' });
        } else {
          notify({ severity: 'error', message: err?.normalizedMessage || 'Could not submit your review right now.' });
        }
        return false;
      } finally {
        setSubmittingReview(false);
      }
    },
    [loadReviews, notify, product]
  );

  if (loading) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !product) {
    return (
      <Container maxWidth="sm" sx={{ py: 10 }}>
        <Paper elevation={0} sx={{ p: { xs: 3, md: 5 }, textAlign: 'center', borderRadius: 4 }}>
          <Typography variant="h4" gutterBottom>
            We could not load this product.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            The product may have been removed or is temporarily unavailable. Please refresh or browse the latest releases.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
            <Button variant="contained" onClick={loadProduct} startIcon={<RefreshIcon />}>
              Try again
            </Button>
            <Button variant="outlined" onClick={() => navigate('/shop')}>
              Back to shop
            </Button>
          </Stack>
        </Paper>
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ mt: 4, pb: 6 }}>
      <Paper elevation={3} sx={{ p: 3 }}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <img src={product.image} alt={product.name} style={{ width: '100%', maxHeight: '400px', objectFit: 'contain' }} />
          </Grid>

          <Grid item xs={12} md={6}>
            <Typography variant="h4" gutterBottom>
              {product.name}
            </Typography>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Brand: {product.brand || 'MansooriKart'}
            </Typography>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              Category: {formatCategory(product.category)}
            </Typography>
            <Typography variant="h6" color="primary" gutterBottom>
              ${product.price}
            </Typography>
            <Typography variant="body1" gutterBottom>
              {product.description}
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', my: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                In Stock:
              </Typography>
              <Chip
                label={
                  product.availability?.canPurchase
                    ? typeof product.stock === 'number'
                      ? `${product.stock} Available`
                      : 'Available from supplier'
                    : 'Out of Stock'
                }
                color={product.availability?.canPurchase ? 'success' : 'error'}
                sx={{ maxWidth: '200px' }}
              />
            </Box>

            {/* The average is published by the API and recalculated from published reviews only, so it is read-only here. */}
            <Box sx={{ display: 'flex', alignItems: 'center', mt: 1, mb: 2 }}>
              <Rating value={product.rating || 0} precision={0.5} readOnly sx={{ mr: 1 }} />
              <Typography variant="body2" color="text.secondary">
                ({product.numReviews || 0} Reviews)
              </Typography>
            </Box>

            <Button variant="contained" color="primary" onClick={handleAddToCart} sx={{ mt: 2 }}>
              Add to Cart
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Box sx={{ mt: 5 }}>
        <Typography variant="h5" gutterBottom>
          Reviews {reviewTotal ? `(${reviewTotal})` : ''}
        </Typography>

        {reviews.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No reviews yet. Be the first to share how this product worked out for you.
          </Typography>
        ) : (
          <Stack divider={<Divider flexItem />} spacing={2}>
            {reviews.map(review => (
              <Box key={review.id}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <Rating value={review.rating || 0} readOnly size="small" />
                  {review.title ? (
                    <Typography variant="subtitle2" fontWeight={700}>
                      {review.title}
                    </Typography>
                  ) : null}
                  {review.verifiedPurchase ? <Chip size="small" color="success" variant="outlined" label="Verified purchase" /> : null}
                </Stack>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  {review.body}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {[review.reviewerName, formatReviewDate(review.createdAt)].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}

        {signedIn ? (
          <ReviewForm onSubmit={handleReviewSubmit} submitting={submittingReview} />
        ) : (
          <Alert
            severity="info"
            sx={{ mt: 3 }}
            action={
              <Button component={RouterLink} to="/login" size="small">
                Sign in
              </Button>
            }
          >
            Sign in to review this product.
          </Alert>
        )}
      </Box>

      <Box sx={{ mt: 5 }}>
        <Typography variant="h5" gutterBottom>
          More like this
        </Typography>

        {relatedLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 3 }}>
            <CircularProgress size={32} />
          </Box>
        ) : related.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing else in this category yet. Browse the shop for the full range.
          </Typography>
        ) : (
          <Grid container spacing={3}>
            {related.map(item => (
              <Grid item xs={12} sm={6} md={4} key={item.id}>
                <Card elevation={4} sx={{ height: '100%' }}>
                  <CardActionArea onClick={() => navigate(`/product/${item.id}`)}>
                    <CardMedia component="img" height="160" image={item.image} alt={item.name} sx={{ objectFit: 'contain', p: 2 }} />
                    <CardContent>
                      <Typography variant="subtitle1" gutterBottom noWrap>
                        {item.name}
                      </Typography>
                      <Typography variant="h6" color="primary">
                        ${item.price}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}
      </Box>
    </Container>
  );
}

export default ProductDetails;
