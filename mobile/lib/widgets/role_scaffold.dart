import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemNavigator;
import 'package:provider/provider.dart';

import '../state/auth_provider.dart';
import '../theme/app_theme.dart';
import 'connectivity_banner.dart';

class RoleNavItem {
  final IconData icon;
  final String label;
  final Widget Function(BuildContext context) builder;
  // BUG FIX (production-readiness pass, Sept 2026 — CI caught this): admin_home_screen.dart's
  // superadmin nav list already passed `headerAbove: 'Admin workspace'` on its 11th item to mark
  // where the "Super Admin workspace" section ends and the "Admin workspace" section begins (see
  // role_portal_nav_test.dart's `items[10].headerAbove` assertion) — but this field never
  // actually existed on RoleNavItem, so the whole file failed to compile. Added here, plus the
  // divider rendering in the drawer's itemBuilder below.
  final String? headerAbove;
  const RoleNavItem({required this.icon, required this.label, required this.builder, this.headerAbove});
}

/// Shared shell for every role portal — a drawer listing that role's
/// sections (mirrors the web app's sidebar), an app bar showing the
/// section title + a live/connected badge, and a body that swaps between
/// sections without losing the drawer. Each role's home screen supplies its
/// own [items]; this widget owns none of the navigation-list content
/// itself so adding/removing a section per role stays a one-line change in
/// that role's home screen file.
class RoleScaffold extends StatefulWidget {
  final String portalTitle;
  final List<RoleNavItem> items;
  final int initialIndex;

  const RoleScaffold({
    super.key,
    required this.portalTitle,
    required this.items,
    this.initialIndex = 0,
  });

  static RoleScaffoldState? of(BuildContext context) {
    return context.findAncestorStateOfType<RoleScaffoldState>();
  }

  @override
  State<RoleScaffold> createState() => RoleScaffoldState();
}

class RoleScaffoldState extends State<RoleScaffold> {
  late int _index = widget.initialIndex;
  DateTime? _lastBackPressAt;

  int get currentIndex => _index;

  // BUG FIX (user report: "aap ko back karne pe close ho ja raha hai" — pressing the phone's
  // back button closes the whole app instead of navigating within it). Root cause: switching
  // drawer sections here only calls `setState(() => _index = i)` — it never pushes a new route
  // onto the Navigator, so there is no back-stack entry for the system back button to pop. This
  // RoleScaffold sits at the root of its role's Navigator, so ANY back press — from ANY section,
  // not just the first one — immediately popped the only route there was and closed the app.
  // Now: back from a non-home section returns to the home section first (matches how most
  // multi-tab apps behave — e.g. WhatsApp/Instagram); back from the home section requires a
  // second press within 2 seconds ("Press back again to exit"), and only then does the app
  // actually close.
  bool _handleBackPress() {
    if (_index != widget.initialIndex) {
      setState(() => _index = widget.initialIndex);
      return false;
    }
    final now = DateTime.now();
    if (_lastBackPressAt != null && now.difference(_lastBackPressAt!) < const Duration(seconds: 2)) {
      return true;
    }
    _lastBackPressAt = now;
    final messenger = ScaffoldMessenger.of(context);
    messenger.clearSnackBars();
    messenger.showSnackBar(const SnackBar(content: Text('Press back again to exit'), duration: Duration(seconds: 2)));
    return false;
  }

  void setIndex(int index) {
    if (index >= 0 && index < widget.items.length) {
      setState(() => _index = index);
    }
  }

  bool navigateToLabel(String label) {
    final query = label.trim().toLowerCase();
    final idx = widget.items.indexWhere((it) => it.label.trim().toLowerCase() == query);
    if (idx != -1) {
      setState(() => _index = idx);
      return true;
    }
    final partialIdx = widget.items.indexWhere(
      (it) => it.label.trim().toLowerCase().contains(query) || query.contains(it.label.trim().toLowerCase()),
    );
    if (partialIdx != -1) {
      setState(() => _index = partialIdx);
      return true;
    }
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final current = widget.items[_index];
    final displayName = auth.user?.name.isNotEmpty == true ? auth.user!.name : 'Account';
    final initials = displayName.trim().isNotEmpty ? displayName.trim()[0].toUpperCase() : '?';

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        // `canPop` is hard-wired to false above, so a real exit can't be done by re-triggering
        // the Navigator's own pop (that would just hit this same PopScope again). Exit the app
        // directly instead, same as Android's own default back behavior at the true home screen.
        if (_handleBackPress()) SystemNavigator.pop();
      },
      child: Scaffold(
      // COMPLETENESS FIX (brand consistency — "same to same as the website"): background/avatar
      // colors below match the web app's own PortalHeader (src/components/Sidebar.jsx) exactly —
      // bg-surface top bar, a primary-light/primary-dark initials avatar — rather than Material's
      // default white app bar with a generic "Live" badge that has no web equivalent.
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1, color: AppColors.border),
        ),
        iconTheme: const IconThemeData(color: AppColors.textPrimary),
        titleSpacing: 0,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(9),
              child: Image.asset('assets/branding/app_icon.png', width: 28, height: 28),
            ),
            const SizedBox(width: 8),
            const Flexible(
              child: Text(
                'BookADoctors',
                style: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w800, fontSize: 16),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpacing.md),
            child: CircleAvatar(
              radius: 16,
              backgroundColor: AppColors.primaryLight,
              child: Text(
                initials,
                style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w700, fontSize: 13),
              ),
            ),
          ),
        ],
      ),
      drawer: Drawer(
        backgroundColor: AppColors.charcoal,
        child: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.sm),
                child: Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.all(Radius.circular(11)),
                      child: Image(image: AssetImage('assets/branding/app_icon.png'), width: 36, height: 36),
                    ),
                    SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: Text(
                        'BookADoctors',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 17),
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                margin: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: AppSpacing.sm),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(AppRadius.button),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(widget.portalTitle, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                    const SizedBox(height: 2),
                    Text(
                      displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: Colors.white.withValues(alpha: 0.6), fontSize: 12),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
                  itemCount: widget.items.length,
                  itemBuilder: (context, i) {
                    final item = widget.items[i];
                    final selected = i == _index;
                    final tile = Padding(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm, vertical: 1),
                      child: ListTile(
                        dense: true,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
                        leading: Icon(item.icon, size: 20, color: selected ? Colors.white : Colors.white.withValues(alpha: 0.75)),
                        title: Text(
                          item.label,
                          style: TextStyle(
                            color: selected ? Colors.white : Colors.white.withValues(alpha: 0.75),
                            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                            fontSize: 14,
                          ),
                        ),
                        selected: selected,
                        selectedTileColor: AppColors.primaryDark,
                        onTap: () {
                          setState(() => _index = i);
                          Navigator.of(context).pop();
                        },
                      ),
                    );
                    // BUG FIX (see RoleNavItem.headerAbove's doc comment): renders the section
                    // divider a superadmin's nav list expects between "Super Admin workspace" and
                    // "Admin workspace" — a plain label + hairline, not a full second drawer header.
                    if (item.headerAbove == null) return tile;
                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(AppSpacing.md, AppSpacing.md, AppSpacing.md, AppSpacing.xs),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Divider(color: Colors.white.withValues(alpha: 0.12), height: 1),
                              const SizedBox(height: AppSpacing.sm),
                              Text(
                                item.headerAbove!.toUpperCase(),
                                style: TextStyle(
                                  color: Colors.white.withValues(alpha: 0.5),
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0.6,
                                ),
                              ),
                            ],
                          ),
                        ),
                        tile,
                      ],
                    );
                  },
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
                child: ListTile(
                  dense: true,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.button)),
                  leading: Icon(Icons.logout, size: 20, color: Colors.white.withValues(alpha: 0.75)),
                  title: Text('Sign out', style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 14)),
                  onTap: () async {
                    Navigator.of(context).pop();
                    await context.read<AuthProvider>().logout();
                  },
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ),
        ),
      ),
      // A single obvious top-level mount point for every role portal screen — see
      // widgets/connectivity_banner.dart's own doc comment for what it does and doesn't cover.
      body: SafeArea(
        top: false,
        bottom: true,
        child: Column(
          children: [
            const ConnectivityBanner(),
            Expanded(child: current.builder(context)),
          ],
        ),
      ),
      ),
    );
  }
}
