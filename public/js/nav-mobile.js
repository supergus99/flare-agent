(function () {
  var nav = document.getElementById('nav');
  if (!nav) return;
  var toggle = nav.querySelector('.nav-toggle');
  var backdrop = nav.querySelector('.nav-backdrop');
  var links = nav.querySelectorAll('.nav-links a');
  function close() {
    nav.classList.remove('nav-open');
    document.body.style.overflow = '';
  }
  function open() {
    nav.classList.add('nav-open');
    document.body.style.overflow = 'hidden';
  }
  function toggleMenu() {
    nav.classList.toggle('nav-open');
    document.body.style.overflow = nav.classList.contains('nav-open') ? 'hidden' : '';
  }
  if (toggle) toggle.addEventListener('click', toggleMenu);
  if (backdrop) backdrop.addEventListener('click', close);
  links.forEach(function (a) { a.addEventListener('click', close); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();
