import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http_parser/http_parser.dart';

import '../config/env.dart';
import 'api_exception.dart';
import 'token_store.dart';

/// Wraps the raw `{success, data, pagination?, message?}` /
/// `{success:false, error:{code,message,details}}` envelope every endpoint
/// in the backend returns (see integration_plan.md §0.1). `data` is
/// already unwrapped for the caller; `pagination` is attached separately
/// (Dart has no equivalent of JS's "attach a hidden prop on the array", so
/// it is just a sibling field here instead).
class ApiResponse {
  final dynamic data;
  final Map<String, dynamic>? pagination;
  final String? message;

  ApiResponse({required this.data, this.pagination, this.message});

  /// Convenience: `data` cast to a `List<Map<String, dynamic>>` — use for
  /// every list endpoint (they always return `data` as a bare array, never
  /// `{rows: [...]}`).
  List<Map<String, dynamic>> get list =>
      (data as List<dynamic>? ?? const []).map((e) => e as Map<String, dynamic>).toList();

  /// Convenience: `data` cast to a `Map<String, dynamic>` — use for every
  /// single-resource endpoint.
  Map<String, dynamic> get map => (data as Map<String, dynamic>? ?? const {});
}

typedef UnauthorizedHandler = void Function();

/// Central HTTP client for the whole app — every screen goes through this,
/// never through `Dio`/`http` directly. Mirrors client/src/lib/apiClient.js
/// endpoint-for-endpoint: same base URL env var intent, same bearer-token
/// header, same silent-refresh-then-retry-once-on-401 behaviour, same
/// de-duplication of concurrent refresh calls, same error shape.
class ApiClient {
  ApiClient._internal() {
    // WEB CRASH FIX: dart:io's Platform.environment/Platform.script throw UnsupportedError at
    // runtime on Flutter Web (dart:io has no real implementation there) — the `kIsWeb` short-
    // circuit must run first so those getters are never reached on a web build. Without this,
    // ApiClient._internal() (run the first time ApiClient.instance is touched, i.e. essentially
    // at app start) would crash immediately on `flutter run -d chrome`, the web quick-check path
    // README.md recommends. See config/env.dart's own `if (!kIsWeb && Platform.isAndroid)` for
    // the same pattern already established elsewhere in this file's neighborhood.
    final isTest = !kIsWeb &&
        (Platform.environment.containsKey('FLUTTER_TEST') ||
            Platform.script.toString().contains('_test') ||
            Platform.script.toString().contains('flutter_test'));
    _dio = Dio(BaseOptions(
      baseUrl: Env.apiBaseUrl,
      connectTimeout: isTest ? const Duration(milliseconds: 100) : const Duration(seconds: 20),
      receiveTimeout: isTest ? const Duration(milliseconds: 100) : const Duration(seconds: 20),
      headers: {'Content-Type': 'application/json'},
    ));

    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        final tokens = TokenStore.instance.current;
        if (tokens != null) {
          options.headers['Authorization'] = 'Bearer ${tokens.accessToken}';
        }
        handler.next(options);
      },
      onError: (DioException error, handler) async {
        final status = error.response?.statusCode;
        final requestPath = error.requestOptions.path;
        final alreadyRetried = error.requestOptions.extra['retried'] == true;

        if (status == 401 && !alreadyRetried && requestPath != '/auth/refresh') {
          final tokens = TokenStore.instance.current;
          if (tokens == null) {
            await TokenStore.instance.clear();
            _onUnauthorized?.call();
            handler.reject(_wrap(error.requestOptions, _shape(error)));
            return;
          }
          try {
            final refreshed = await _refreshTokens(tokens.refreshToken);
            await TokenStore.instance.save(refreshed);

            final retryOptions = error.requestOptions;
            retryOptions.extra['retried'] = true;
            retryOptions.headers['Authorization'] = 'Bearer ${refreshed.accessToken}';
            final response = await _dio.fetch(retryOptions);
            handler.resolve(response);
            return;
          } catch (refreshError) {
            await TokenStore.instance.clear();
            _onUnauthorized?.call();
            // Propagate the *refresh* call's own failure (e.g. "refresh token
            // expired" from the backend, or a connection error) instead of the
            // original request's generic 401 — mirrors the web client's
            // `shapeError(refreshErr.response?.data, refreshErr)` in the
            // equivalent catch block (client/src/lib/apiClient.js).
            if (refreshError is DioException) {
              handler.reject(_wrap(error.requestOptions, _shape(refreshError)));
            } else {
              handler.reject(_wrap(
                error.requestOptions,
                ApiException(
                  message: 'Your session has expired. Please sign in again.',
                  status: error.response?.statusCode,
                ),
              ));
            }
            return;
          }
        }

        if (status == 401) {
          await TokenStore.instance.clear();
          _onUnauthorized?.call();
        }

        handler.reject(_wrap(error.requestOptions, _shape(error)));
      },
    ));
  }

  static final ApiClient instance = ApiClient._internal();

  late final Dio _dio;
  UnauthorizedHandler? _onUnauthorized;

  // De-dupes concurrent 401s into a single /auth/refresh call, same as the
  // web client's `refreshPromise` module-level variable.
  Future<TokenPair>? _refreshInFlight;

  void registerUnauthorizedHandler(UnauthorizedHandler handler) {
    _onUnauthorized = handler;
  }

  Future<TokenPair> _refreshTokens(String refreshToken) {
    _refreshInFlight ??= _dio
        .post('/auth/refresh', data: {'refreshToken': refreshToken})
        .then((response) {
      final body = response.data as Map<String, dynamic>;
      final data = body['data'] as Map<String, dynamic>;
      return TokenPair.fromJson(data);
    }).whenComplete(() {
      _refreshInFlight = null;
    });
    return _refreshInFlight!;
  }

  // Dio 5.x's ErrorInterceptorHandler.reject() only accepts a DioException (older versions
  // accepted any Object) — this wraps our already-shaped ApiException in one so `handler.reject`
  // type-checks, carrying the ApiException in DioException.error so `_shape` below can recognize
  // and unwrap an already-shaped error instead of re-shaping it (which would lose the real
  // message/code and fall back to the generic "Something went wrong").
  DioException _wrap(RequestOptions options, ApiException exception) => DioException(
        requestOptions: options,
        error: exception,
        type: DioExceptionType.unknown,
        message: exception.message,
      );

  ApiException _shape(DioException error) {
    // Already shaped (came back out of the interceptor above via _wrap) — return as-is rather
    // than re-deriving from error.response, which would be null on this synthetic DioException.
    if (error.error is ApiException) return error.error as ApiException;

    final body = error.response?.data;
    String message = 'Something went wrong. Please try again.';
    String? code;
    dynamic details;
    if (body is Map<String, dynamic>) {
      final err = body['error'];
      if (err is Map<String, dynamic>) {
        message = (err['message'] as String?) ?? message;
        code = err['code'] as String?;
        details = err['details'];
      }
    } else if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.connectionError) {
      message = 'Cannot reach the server. Check that the backend is running and reachable.';
    }
    return ApiException(
      message: message,
      code: code,
      details: details,
      status: error.response?.statusCode,
    );
  }

  ApiResponse _unwrap(Response response) {
    final body = response.data;
    if (body is! Map<String, dynamic>) {
      return ApiResponse(data: body);
    }
    if (body['success'] == false) {
      final err = body['error'] as Map<String, dynamic>?;
      throw ApiException(
        message: (err?['message'] as String?) ?? 'Request failed',
        code: err?['code'] as String?,
        details: err?['details'],
        status: response.statusCode,
      );
    }
    return ApiResponse(
      data: body['data'],
      pagination: body['pagination'] as Map<String, dynamic>?,
      message: body['message'] as String?,
    );
  }

  Future<ApiResponse> get(String path, {Map<String, dynamic>? query}) async {
    try {
      final response = await _dio.get(path, queryParameters: _clean(query));
      return _unwrap(response);
    } on DioException catch (e) {
      throw _shape(e);
    }
  }

  Future<ApiResponse> post(String path, {dynamic body}) async {
    try {
      final response = await _dio.post(path, data: body);
      return _unwrap(response);
    } on DioException catch (e) {
      throw _shape(e);
    }
  }

  Future<ApiResponse> patch(String path, {dynamic body}) async {
    try {
      final response = await _dio.patch(path, data: body);
      return _unwrap(response);
    } on DioException catch (e) {
      throw _shape(e);
    }
  }

  Future<ApiResponse> put(String path, {dynamic body}) async {
    try {
      final response = await _dio.put(path, data: body);
      return _unwrap(response);
    } on DioException catch (e) {
      throw _shape(e);
    }
  }

  Future<ApiResponse> delete(String path, {dynamic body}) async {
    try {
      final response = await _dio.delete(path, data: body);
      return _unwrap(response);
    } on DioException catch (e) {
      throw _shape(e);
    }
  }

  /// COMPLETENESS FIX (audit Priority 3 #8 — mobile parity): shared multipart-upload path for
  /// POST /media/photo, /media/document, /media/qr (services/fileUploadService.js — multipart
  /// field name is always 'file' across all three, per that file's own header comment).
  /// `mimeType` MUST be one this base's Dio instance's default `Content-Type: application/json`
  /// header (see the constructor above) does not leak onto this request — Dio only overrides that
  /// header with the correct `multipart/form-data; boundary=...` value when the outgoing `data` is
  /// a `FormData` instance, which is exactly what this method always sends, so callers never need
  /// to think about that themselves. `extraFields` mirrors non-file multipart text fields the
  /// backend expects alongside the file (e.g. /media/qr's required `clinicId`, /media/document's
  /// optional `name`) — see uploads.validation.js.
  Future<ApiResponse> uploadFile(
    String path, {
    required String filePath,
    required String mimeType,
    Map<String, String>? extraFields,
  }) async {
    try {
      final parts = mimeType.split('/');
      final formData = FormData.fromMap({
        ...(extraFields ?? {}),
        'file': await MultipartFile.fromFile(
          filePath,
          // ImagePicker returns POSIX paths on Android/iOS, while desktop and
          // Windows test paths use backslashes. Sending the complete Windows
          // path as a filename is both incorrect and leaks local path details.
          filename: filePath.split(RegExp(r'[\\/]+')).last,
          contentType: MediaType(parts.first, parts.length > 1 ? parts[1] : 'octet-stream'),
        ),
      });
      final response = await _dio.post(path, data: formData);
      return _unwrap(response);
    } on DioException catch (e) {
      throw _shape(e);
    }
  }

  /// Drops null-valued query params (Dio would otherwise send `key=null`).
  Map<String, dynamic>? _clean(Map<String, dynamic>? query) {
    if (query == null) return null;
    final out = <String, dynamic>{};
    query.forEach((key, value) {
      if (value != null) out[key] = value;
    });
    return out;
  }

  void setFastTimeoutsForTesting() {
    _dio.options.connectTimeout = const Duration(milliseconds: 100);
    _dio.options.receiveTimeout = const Duration(milliseconds: 100);
  }

  void setMockFailAdapter() {
    _dio.httpClientAdapter = _MockFailAdapter();
  }
}

class _MockFailAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    throw DioException.connectionError(
      requestOptions: options,
      reason: 'Cannot reach the server in test environment.',
    );
  }

  @override
  void close({bool force = false}) {}
}
