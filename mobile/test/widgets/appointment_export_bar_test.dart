import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:connect_mobile/core/api_client.dart';
import 'package:connect_mobile/core/india_time.dart';
import 'package:connect_mobile/theme/app_theme.dart';
import 'package:connect_mobile/widgets/appointment_export_bar.dart';
import 'patient_functional_flow_test.dart' show FlowAdapter;

void main() {
  testWidgets(
      'staff date-range export produces a real filtered CSV attachment at narrow width',
      (tester) async {
    final directory = (await tester.runAsync(() =>
        Directory.systemTemp.createTemp('bookadoctors-staff-csv-')))!;
    final calls = <MethodCall>[];
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
        const MethodChannel('plugins.flutter.io/path_provider'),
        (_) async => directory.path);
    messenger.setMockMethodCallHandler(
        const MethodChannel('dev.fluttercommunity.plus/share'), (call) async {
      calls.add(call);
      return 'dev.fluttercommunity.plus/share/unavailable';
    });
    final adapter = FlowAdapter();
    adapter.appointmentRows = [
      {
        ...adapter.appointment,
        'id': 'old-not-exported',
        'appointmentDate': '2020-01-01'
      },
      {...adapter.appointment, 'id': 'today-exported'},
    ];
    ApiClient.instance.setHttpAdapterForTesting(adapter);
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
        theme: AppTheme.dark,
        builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.4)),
            child: child!),
        home: const Scaffold(
            body: Align(
                alignment: Alignment.topCenter,
                child: AppointmentExportBar()))));
    await tester.runAsync(() async {
      await tester.tap(find.byTooltip('Download CSV'));
      for (var index = 0; index < 100 && calls.isEmpty; index++) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
    });
    await tester.pumpAndSettle();
    expect(calls.single.method, 'shareFiles');
    final path =
        ((calls.single.arguments as Map)['paths'] as List).single as String;
    final contents = await tester.runAsync(() => File(path).readAsString());
    expect(contents, contains('today-exported'));
    expect(contents, isNot(contains('old-not-exported')));
    expect(contents, contains('Booked on (IST)'));
    final request = adapter.requests
        .singleWhere((request) => request.path == '/appointments');
    expect(request.queryParameters['dateFrom'], indiaToday());
    expect(request.queryParameters['dateTo'], indiaToday());
    expect(tester.takeException(), isNull);
  });
}
