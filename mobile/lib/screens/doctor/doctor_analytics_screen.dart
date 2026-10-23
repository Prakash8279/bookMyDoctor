import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/api_client.dart';
import '../../core/india_time.dart';
import '../../theme/app_theme.dart';
import '../../widgets/common_widgets.dart';

class DoctorAnalyticsScreen extends StatefulWidget {
  const DoctorAnalyticsScreen({super.key});

  @override
  State<DoctorAnalyticsScreen> createState() => _DoctorAnalyticsScreenState();
}

class _DoctorAnalyticsScreenState extends State<DoctorAnalyticsScreen> {
  late Future<Map<String, dynamic>> _future = _load();

  Future<Map<String, dynamic>> _load() async {
    final results = await Future.wait([
      ApiClient.instance.getAll('/appointments', query: {'pageSize': 100}),
      ApiClient.instance.getAll('/payments', query: {'pageSize': 100}),
    ]);
    return buildDoctorAnalytics(results[0].list, results[1].list);
  }

  @override
  Widget build(BuildContext context) =>
      ListView(padding: const EdgeInsets.all(AppSpacing.md), children: [
        const PageHeader(
            title: 'Practice analytics',
            subtitle:
                'Your last seven days of appointments, completion, and revenue.'),
        FutureBuilder<Map<String, dynamic>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return ErrorBanner(
                    error: snapshot.error!,
                    onRetry: () => setState(() {
                          _future = _load();
                        }));
              }
              final value = snapshot.data!;
              final total = value['appointments'] as int;
              final completed = value['completed'] as int;
              final rate = total == 0 ? 0 : ((completed / total) * 100).round();
              return Column(children: [
                Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      _AnalyticsCard(
                          label: 'Appointments',
                          value: '$total',
                          icon: Icons.event_note_outlined),
                      _AnalyticsCard(
                          label: 'Completion rate',
                          value: '$rate%',
                          icon: Icons.task_alt),
                      _AnalyticsCard(
                          label: 'Cancelled',
                          value: '${value['cancelled']}',
                          icon: Icons.event_busy_outlined),
                    ]),
                const SizedBox(height: AppSpacing.md),
                _TrendCard(
                    title: 'Appointments',
                    labels: List<String>.from(value['labels'] as List),
                    values: List<num>.from(value['appointmentTrend'] as List),
                    line: true),
                const SizedBox(height: AppSpacing.md),
                _TrendCard(
                    title: 'Revenue',
                    labels: List<String>.from(value['labels'] as List),
                    values: List<num>.from(value['revenueTrend'] as List),
                    currency: true),
              ]);
            }),
      ]);
}

@visibleForTesting
Map<String, dynamic> buildDoctorAnalytics(
    List<dynamic> appointments, List<dynamic> payments,
    {DateTime? now}) {
  final today = indiaClock(now);
  final days = List.generate(
      7, (index) => DateTime(today.year, today.month, today.day - (6 - index)));
  final keys = days.map((day) => DateFormat('yyyy-MM-dd').format(day)).toList();
  final completed =
      appointments.where((row) => row['status'] == 'completed').length;
  final cancelled =
      appointments.where((row) => row['status'] == 'cancelled').length;
  return {
    'appointments': appointments.length,
    'completed': completed,
    'cancelled': cancelled,
    'labels': days.map((day) => DateFormat('EEE').format(day)).toList(),
    'appointmentTrend': keys
        .map((key) => appointments
            .where((row) =>
                indiaRecordDate(
                    (row['appointmentDate'] ?? row['createdAt'])?.toString()) ==
                key)
            .length)
        .toList(),
    'revenueTrend': keys
        .map((key) => payments
            .where((row) =>
                row['status']?.toString().toLowerCase() == 'paid' &&
                indiaRecordDate(row['createdAt']?.toString()) == key)
            .fold<double>(
                0,
                (sum, row) =>
                    sum +
                    (num.tryParse((row['reportAmount'] ?? row['amount'] ?? 0)
                                .toString()) ??
                            0)
                        .toDouble()))
        .toList(),
  };
}

class _AnalyticsCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  const _AnalyticsCard(
      {required this.label, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) => Container(
        width: 155,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
            color: context.palette.surface,
            borderRadius: BorderRadius.circular(AppRadius.card),
            border: Border.all(color: context.palette.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: context.palette.primaryDark),
          const SizedBox(height: 10),
          Text(value,
              style:
                  const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
          Text(label, style: TextStyle(color: context.palette.textSecondary))
        ]),
      );
}

class _TrendCard extends StatelessWidget {
  final String title;
  final List<String> labels;
  final List<num> values;
  final bool line;
  final bool currency;
  const _TrendCard(
      {required this.title,
      required this.labels,
      required this.values,
      this.line = false,
      this.currency = false});

  @override
  Widget build(BuildContext context) {
    final total =
        values.fold<double>(0, (sum, value) => sum + value.toDouble());
    return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
            color: context.palette.surface,
            borderRadius: BorderRadius.circular(AppRadius.card),
            border: Border.all(color: context.palette.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
                child: Text(title,
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w700))),
            Text(currency ? '₹${total.toStringAsFixed(0)}' : '${total.round()}',
                style: TextStyle(
                    color: context.palette.textSecondary,
                    fontWeight: FontWeight.w700))
          ]),
          const SizedBox(height: AppSpacing.md),
          Semantics(
              label: '$title, last 7 days',
              value:
                  List.generate(labels.length, (index) => '${labels[index]} ${values[index]}')
                      .join(', '),
              child: SizedBox(
                  height: 132,
                  child: CustomPaint(
                      painter: _TrendPainter(
                          values: values,
                          color: line
                              ? context.palette.primaryDark
                              : context.palette.success,
                          line: line),
                      child: Align(
                          alignment: Alignment.bottomCenter,
                          child: Row(
                              children: labels
                                  .map((label) => Expanded(
                                      child: Center(
                                          child: FittedBox(
                                              fit: BoxFit.scaleDown,
                                              child: Text(label,
                                                  maxLines: 1,
                                                  style: TextStyle(
                                                      fontSize: 11,
                                                      color: context.palette.textSecondary))))))
                                  .toList())))))
        ]));
  }
}

class _TrendPainter extends CustomPainter {
  final List<num> values;
  final Color color;
  final bool line;
  const _TrendPainter(
      {required this.values, required this.color, required this.line});

  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty) return;
    final chartHeight = size.height - 28;
    final maxValue = math.max<double>(
        1,
        values.fold<double>(
            0, (max, value) => math.max(max, value.toDouble())));
    final step = size.width / values.length;
    final paint = Paint()
      ..color = color
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round
      ..style = line ? PaintingStyle.stroke : PaintingStyle.fill;
    if (line) {
      final path = Path();
      for (var index = 0; index < values.length; index++) {
        final point = Offset(step * (index + .5),
            chartHeight - (values[index].toDouble() / maxValue * chartHeight));
        index == 0
            ? path.moveTo(point.dx, point.dy)
            : path.lineTo(point.dx, point.dy);
      }
      canvas.drawPath(path, paint);
      paint.style = PaintingStyle.fill;
      for (var index = 0; index < values.length; index++) {
        canvas.drawCircle(
            Offset(
                step * (index + .5),
                chartHeight -
                    (values[index].toDouble() / maxValue * chartHeight)),
            4,
            paint);
      }
    } else {
      for (var index = 0; index < values.length; index++) {
        final height = values[index].toDouble() / maxValue * chartHeight;
        canvas.drawRRect(
            RRect.fromRectAndRadius(
                Rect.fromLTWH(step * index + step * .2, chartHeight - height,
                    step * .6, math.max<double>(2, height)),
                const Radius.circular(4)),
            paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _TrendPainter oldDelegate) =>
      oldDelegate.values != values ||
      oldDelegate.color != color ||
      oldDelegate.line != line;
}
