const mockAdd = jest.fn().mockResolvedValue({ id: 'notification-n1' });
jest.mock('bullmq', () => ({ Queue: jest.fn().mockImplementation(() => ({ add: mockAdd, close: jest.fn(), on: jest.fn() })) }));
jest.mock('../../../src/config/redis', () => ({}));
const { enqueueNotification } = require('../../../src/jobs/notificationQueue');

test('persists a unique retryable job without waiting for SMTP', async () => {
  await enqueueNotification('n1', 'u1', { emailAmount: 'Rs. 500' });
  expect(mockAdd).toHaveBeenCalledWith('deliver', { notificationId: 'n1', userId: 'u1', message: { emailAmount: 'Rs. 500' } }, expect.objectContaining({ jobId: 'notification-n1', attempts: 5, backoff: { type: 'exponential', delay: 2000 } }));
});
