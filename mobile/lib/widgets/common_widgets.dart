import 'package:flutter/material.dart';

import '../core/api_exception.dart';
import '../theme/app_theme.dart';

/// In-body page header — mirrors the web app's shared `Page` component
/// (an optional uppercase "kicker" label, a big bold title, an optional
/// muted subtitle, an optional action on the right) used at the top of
/// nearly every role-portal page on web. The AppBar already shows a short
/// section label; this is the same larger title+subtitle block web shows
/// below its own top bar, so a screen "looks like the website" instead of
/// just having a bare list under a plain AppBar title.
class PageHeader extends StatelessWidget {
  final String title;
  final String? subtitle;
  final String? kicker;
  final Widget? action;

  const PageHeader({super.key, required this.title, this.subtitle, this.kicker, this.action});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (kicker != null) ...[
                  Text(
                    kicker!.toUpperCase(),
                    style: const TextStyle(
                      color: AppColors.primaryDark,
                      fontWeight: FontWeight.w700,
                      fontSize: 11,
                      letterSpacing: 1.1,
                    ),
                  ),
                  const SizedBox(height: 4),
                ],
                Text(
                  title,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 4),
                  Text(subtitle!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                ],
              ],
            ),
          ),
          if (action != null) action!,
        ],
      ),
    );
  }
}

/// Centered spinner for a full-screen or full-section loading state.
class LoadingView extends StatelessWidget {
  final String? message;
  const LoadingView({super.key, this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(),
          if (message != null) ...[
            const SizedBox(height: AppSpacing.md),
            Text(message!, style: const TextStyle(color: AppColors.textSecondary)),
          ],
        ],
      ),
    );
  }
}

/// Shown when a list endpoint returns zero rows — mirrors the web app's
/// EmptyState component so the two clients feel consistent.
class EmptyStateView extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? action;

  const EmptyStateView({
    super.key,
    this.icon = Icons.inbox_outlined,
    required this.title,
    this.subtitle,
    this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: AppColors.textSecondary),
            const SizedBox(height: AppSpacing.md),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary),
              ),
            ],
            if (action != null) ...[
              const SizedBox(height: AppSpacing.md),
              action!,
            ],
          ],
        ),
      ),
    );
  }
}

/// Inline error banner — the standard way any screen surfaces a failed API
/// call. Reads a plain String message OR an ApiException directly.
class ErrorBanner extends StatelessWidget {
  final Object error;
  final VoidCallback? onRetry;

  const ErrorBanner({super.key, required this.error, this.onRetry});

  String get _message {
    if (error is ApiException) return (error as ApiException).message;
    return error.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.danger.withOpacity(0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.danger.withOpacity(0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, color: AppColors.danger, size: 20),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(_message, style: const TextStyle(color: AppColors.danger)),
          ),
          if (onRetry != null)
            TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

/// Small rounded pill showing a status string with a consistent color, used
/// across appointments/queue/payments/clinics/etc list rows. Mirrors the web
/// app's Badge/StatusPill components tone-for-tone — see statusTone() in
/// theme/app_theme.dart.
class StatusBadge extends StatelessWidget {
  final String status;
  const StatusBadge({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final tone = statusTone(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        status.replaceAll('_', ' '),
        style: TextStyle(color: tone.foreground, fontWeight: FontWeight.w600, fontSize: 12),
      ),
    );
  }
}

/// Full-width primary action button with a built-in loading spinner state —
/// used on every form's submit button so "submitting..." looks identical
/// everywhere.
class PrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;

  const PrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: loading ? null : onPressed,
        child: loading
            ? const SizedBox(
                height: 20,
                width: 20,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
              )
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null) ...[Icon(icon, size: 18), const SizedBox(width: 8)],
                  Text(label),
                ],
              ),
      ),
    );
  }
}

/// A labeled card wrapper used to group form sections / detail sections
/// consistently across all role screens.
class SectionCard extends StatelessWidget {
  final String? title;
  final Widget child;
  final Widget? trailing;

  const SectionCard({super.key, this.title, required this.child, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (title != null) ...[
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title!,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
                    ),
                  ),
                  if (trailing != null) trailing!,
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
            child,
          ],
        ),
      ),
    );
  }
}

/// Dashboard stat tile — mirrors the web app's StatCard component
/// (src/components/StatCard.jsx) layout exactly: a muted label with a
/// primary-light icon badge on the same row, a big bold value below, and an
/// optional success-colored detail line.
class StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final String? detail;
  final VoidCallback? onTap;

  const StatCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.detail,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      label,
                      style: const TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w500, fontSize: 13),
                    ),
                  ),
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: AppColors.primaryLight,
                      borderRadius: BorderRadius.circular(AppRadius.button),
                    ),
                    child: Icon(icon, size: 18, color: AppColors.primaryDark),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
              if (detail != null) ...[
                const SizedBox(height: 2),
                Text(detail!, style: const TextStyle(color: AppColors.success, fontSize: 11, fontWeight: FontWeight.w600)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Standard pull-to-refresh + FutureBuilder-driven async body: shows
/// [LoadingView] while pending, [ErrorBanner] + retry on failure, and
/// [EmptyStateView] when [isEmpty] returns true for the resolved data.
/// Every list/detail screen in the app is built on this one widget so
/// loading/error/empty handling never has to be reimplemented per screen.
class AsyncScreen<T> extends StatefulWidget {
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data) builder;
  final bool Function(T data)? isEmpty;
  final String emptyTitle;
  final String? emptySubtitle;
  final IconData emptyIcon;

  const AsyncScreen({
    super.key,
    required this.load,
    required this.builder,
    this.isEmpty,
    this.emptyTitle = 'Nothing here yet',
    this.emptySubtitle,
    this.emptyIcon = Icons.inbox_outlined,
  });

  @override
  State<AsyncScreen<T>> createState() => _AsyncScreenState<T>();
}

class _AsyncScreenState<T> extends State<AsyncScreen<T>> {
  late Future<T> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.load();
  }

  Future<void> _refresh() async {
    final next = widget.load();
    setState(() => _future = next);
    await next;
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _refresh,
      child: FutureBuilder<T>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return ListView(children: const [
              SizedBox(height: 120),
              LoadingView(),
            ]);
          }
          if (snapshot.hasError) {
            return ListView(
              padding: const EdgeInsets.all(AppSpacing.md),
              children: [
                ErrorBanner(error: snapshot.error!, onRetry: _refresh),
              ],
            );
          }
          final data = snapshot.data as T;
          if (widget.isEmpty != null && widget.isEmpty!(data)) {
            return ListView(children: [
              const SizedBox(height: 80),
              EmptyStateView(
                icon: widget.emptyIcon,
                title: widget.emptyTitle,
                subtitle: widget.emptySubtitle,
              ),
            ]);
          }
          return widget.builder(context, data);
        },
      ),
    );
  }
}

/// Shows a transient snackbar for a caught error/message — the standard way
/// a form submit failure is surfaced (loading states use ErrorBanner, one-off
/// actions use this).
void showErrorSnack(BuildContext context, Object error) {
  final message = error is ApiException ? error.message : error.toString();
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), backgroundColor: AppColors.danger),
  );
}

void showSuccessSnack(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message), backgroundColor: AppColors.success),
  );
}
