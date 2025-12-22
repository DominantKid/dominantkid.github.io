<script>
let visits = localStorage.getItem("visits") || 0;
visits++;
localStorage.setItem("visits", visits);
document.write("<p>You have visited this page " + visits + " times.</p>");
</script>
