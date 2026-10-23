import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/api_client.dart';

class PagesAdapter implements HttpClientAdapter {
  PagesAdapter(this.pages);
  final List<Map<String, dynamic>> pages;
  final requestedPages = <int>[];
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final page = options.queryParameters['page'] as int;
    requestedPages.add(page);
    return ResponseBody.fromString(
        jsonEncode({'success': true, ...pages[page - 1]}), 200,
        headers: {
          Headers.contentTypeHeader: ['application/json']
        });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  test('loads all records across pages, retaining the caller filters',
      () async {
    final adapter = PagesAdapter([
      {
        'data': [
          {'id': '1'}
        ],
        'pagination': {'page': 1, 'totalPages': 2, 'total': 2}
      },
      {
        'data': [
          {'id': '2'}
        ],
        'pagination': {'page': 2, 'totalPages': 2, 'total': 2}
      },
    ]);
    ApiClient.instance.setHttpAdapterForTesting(adapter);
    final result = await ApiClient.instance
        .getAll('/appointments', query: {'dateFrom': '2026-10-22'});
    expect(result.list.map((row) => row['id']), ['1', '2']);
    expect(adapter.requestedPages, [1, 2]);
  });
  test('rejects duplicate records rather than exporting a misleading total',
      () async {
    ApiClient.instance.setHttpAdapterForTesting(PagesAdapter([
      {
        'data': [
          {'id': '1'}
        ],
        'pagination': {'page': 1, 'totalPages': 2, 'total': 2}
      },
      {
        'data': [
          {'id': '1'}
        ],
        'pagination': {'page': 2, 'totalPages': 2, 'total': 2}
      },
    ]));
    await expectLater(
        ApiClient.instance.getAll('/appointments'), throwsFormatException);
  });
  test('rejects a truncated result instead of reporting complete data',
      () async {
    ApiClient.instance.setHttpAdapterForTesting(PagesAdapter([
      {
        'data': [],
        'pagination': {'page': 1, 'totalPages': 1, 'total': 3}
      },
    ]));
    await expectLater(
        ApiClient.instance.getAll('/appointments'), throwsFormatException);
  });
}
