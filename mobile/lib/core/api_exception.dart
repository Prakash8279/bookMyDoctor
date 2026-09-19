/// Shaped error thrown by [ApiClient] on any failed request — mirrors the
/// web app's `shapeError()` in apiClient.js so error-handling UI logic
/// stays consistent between the two clients.
class ApiException implements Exception {
  final String message;
  final String? code;
  final dynamic details;
  final int? status;

  ApiException({
    required this.message,
    this.code,
    this.details,
    this.status,
  });

  @override
  String toString() => message;
}
